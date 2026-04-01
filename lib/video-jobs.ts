import type { GenerateVideosOperation } from '@google/genai';
import { getTask } from '@/lib/runway';
import {
  advanceVideoOperation,
  completeVideoOperationToDataUrl,
} from '@/lib/veo';
import { persistMp4DataUrlToPublic } from '@/lib/persist-video';
import { withTimeout } from '@/lib/fetch-timeout';

const RUNWAY_POLL_TIMEOUT_MS = 90_000;

/** 自创建时刻起，允许轮询的最长时间（与原先单请求轮询上限一致） */
const JOB_DEADLINE_MS = 300_000;

type VeoJob = { kind: 'veo'; apiKey: string; operation: GenerateVideosOperation; created: number };
type RunwayJob = { kind: 'runway'; apiKey: string; taskId: string; created: number };

type Terminal = { videoUrl: string } | { error: string };

const pending = new Map<string, VeoJob | RunwayJob>();
const done = new Map<string, Terminal>();

function pruneStale() {
  const now = Date.now();
  const maxAge = 35 * 60 * 1000;
  pending.forEach((job, id) => {
    if (now - job.created > maxAge) pending.delete(id);
  });
}

export function registerVeoJob(jobId: string, apiKey: string, operation: GenerateVideosOperation) {
  pruneStale();
  pending.set(jobId, { kind: 'veo', apiKey, operation, created: Date.now() });
}

export function registerRunwayJob(jobId: string, apiKey: string, taskId: string) {
  pruneStale();
  pending.set(jobId, { kind: 'runway', apiKey, taskId, created: Date.now() });
}

function runwayOutputToUrl(task: {
  status: string;
  output?: string | { url?: string } | Array<{ url?: string }>;
}): string {
  const out = task.output;
  if (typeof out === 'string') return out;
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    const o = out as { url?: string; output?: string | { url?: string } };
    if (o.url) return o.url;
    if (typeof o.output === 'string') return o.output;
    if (o.output && typeof o.output === 'object' && 'url' in o.output && o.output.url) {
      return (o.output as { url: string }).url;
    }
  }
  if (Array.isArray(task.output) && task.output[0]?.url) return task.output[0].url;
  throw new Error('任务成功但无输出 URL');
}

/**
 * 单次短请求内：推进任务一步（Veo 拉一次 LRO；Runway 查一次任务）。
 */
export async function pollVideoJob(jobId: string): Promise<
  | { status: 'pending' }
  | { status: 'done'; videoUrl: string }
  | { status: 'error'; message: string }
> {
  pruneStale();
  const settled = done.get(jobId);
  if (settled) {
    return 'videoUrl' in settled
      ? { status: 'done', videoUrl: settled.videoUrl }
      : { status: 'error', message: settled.error };
  }

  const job = pending.get(jobId);
  if (!job) {
    return { status: 'error', message: '任务不存在或已过期，请重新生成' };
  }

  if (Date.now() - job.created > JOB_DEADLINE_MS) {
    pending.delete(jobId);
    done.set(jobId, { error: '视频生成超时，请重试' });
    return { status: 'error', message: '视频生成超时，请重试' };
  }

  if (job.kind === 'veo') {
    let op = job.operation;
    if (op.done !== true) {
      try {
        op = await advanceVideoOperation(job.apiKey, op);
      } catch (e) {
        const message = e instanceof Error ?  e.message : String(e);
        pending.delete(jobId);
        done.set(jobId, { error: message });
        return { status: 'error', message };
      }
      pending.set(jobId, { ...job, operation: op });
    }

    if (op.done !== true) {
      return { status: 'pending' };
    }

    try {
      const dataUrl = await completeVideoOperationToDataUrl(job.apiKey, op);
      const videoUrl = persistMp4DataUrlToPublic(dataUrl);
      pending.delete(jobId);
      done.set(jobId, { videoUrl });
      return { status: 'done', videoUrl };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      pending.delete(jobId);
      done.set(jobId, { error: message });
      return { status: 'error', message };
    }
  }

  try {
    const task = await withTimeout(
      getTask(job.apiKey, job.taskId),
      RUNWAY_POLL_TIMEOUT_MS,
      '查询 Runway 任务状态超时，请稍后重试'
    );
    if (task.status === 'SUCCEEDED') {
      const videoUrl = runwayOutputToUrl(task);
      pending.delete(jobId);
      done.set(jobId, { videoUrl });
      return { status: 'done', videoUrl };
    }
    if (task.status === 'FAILED' || task.status === 'CANCELLED') {
      const fail = task as { failure?: string };
      const message = fail.failure || `任务失败: ${task.status}`;
      pending.delete(jobId);
      done.set(jobId, { error: message });
      return { status: 'error', message };
    }
    return { status: 'pending' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    pending.delete(jobId);
    done.set(jobId, { error: message });
    return { status: 'error', message };
  }
}
