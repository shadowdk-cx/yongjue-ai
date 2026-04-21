import { randomBytes } from 'crypto';

type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

type ImageJob = {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  url?: string;
  error?: string;
};

const JOB_TTL_MS = 30 * 60 * 1000;
const GLOBAL_KEY = '__ecom_ai_image_jobs__';
const jobs: Map<string, ImageJob> = (globalThis as any)[GLOBAL_KEY] || new Map<string, ImageJob>();
(globalThis as any)[GLOBAL_KEY] = jobs;

function now() {
  return Date.now();
}

function cleanupExpiredJobs() {
  const deadline = now() - JOB_TTL_MS;
  jobs.forEach((job, id) => {
    if (job.updatedAt < deadline) jobs.delete(id);
  });
}

function setJob(id: string, patch: Partial<ImageJob>) {
  const current = jobs.get(id);
  if (!current) return;
  jobs.set(id, { ...current, ...patch, updatedAt: now() });
}

export function createImageJob(
  worker: () => Promise<string>,
  options?: { timeoutMs?: number; timeoutMessage?: string }
) {
  cleanupExpiredJobs();
  const id = randomBytes(10).toString('hex');
  const ts = now();
  jobs.set(id, { id, status: 'pending', createdAt: ts, updatedAt: ts });

  void (async () => {
    try {
      setJob(id, { status: 'running', error: undefined });
      const timeoutMs = Math.max(1_000, options?.timeoutMs ?? 180_000);
      const timeoutMessage = options?.timeoutMessage || '任务超时，请重试';
      const url = await Promise.race<string>([
        worker(),
        new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        }),
      ]);
      setJob(id, { status: 'succeeded', url });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setJob(id, { status: 'failed', error: msg || '生图失败' });
    }
  })();

  return id;
}

export function getImageJob(id: string): ImageJob | null {
  cleanupExpiredJobs();
  return jobs.get(id) || null;
}
