import type { GenerateVideosOperation } from '@google/genai';
import { getTask } from '@/lib/runway';
import { withTimeout } from '@/lib/fetch-timeout';

const RUNWAY_POLL_TIMEOUT_MS = 90_000;
const VEO_POLL_TIMEOUT_MS = 30_000;

type RawLroResponse = {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: Record<string, unknown>;
};

/**
 * 直接调 REST API 查 Veo LRO 状态，绕过 SDK bug（v1.45 getVideosOperation 始终返回 done=undefined）
 */
async function pollVeoRest(apiKey: string, operationName: string): Promise<RawLroResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(VEO_POLL_TIMEOUT_MS) });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`查询 Veo 任务失败（HTTP ${res.status}）：${body.slice(0, 300)}`);
  }
  if (process.env.NODE_ENV === 'development') {
    console.log(`[pollVeoRest] status=${res.status} bodyLen=${body.length}`);
  }
  try {
    return JSON.parse(body) as RawLroResponse;
  } catch {
    throw new Error(`Veo REST 返回非 JSON: ${body.slice(0, 200)}`);
  }
}

/** 自创建时刻起，允许轮询的最长时间（与原先单请求轮询上限一致） */
const JOB_DEADLINE_MS = 300_000;

type VeoJob = { kind: 'veo'; apiKey: string; operation: GenerateVideosOperation; created: number };
type RunwayJob = { kind: 'runway'; apiKey: string; taskId: string; created: number };

type Terminal = { videoUrl: string } | { error: string };
type ReadyToStream = { googleUri: string; apiKey: string };

/**
 * 从 Veo REST 响应中深度提取视频 URI，兼容多种可能的嵌套结构。
 */
function extractVideoUri(response: Record<string, unknown> | undefined): string | undefined {
  if (!response) return undefined;
  const json = JSON.stringify(response);
  const match = json.match(/"uri"\s*:\s*"(https:\/\/[^"]+)"/);
  return match?.[1];
}

/**
 * 检测 Google 内容安全过滤，返回过滤原因（如果有）。
 * Veo 被拦截时响应包含 isMediaFilteredCount / aiMediaFilteredReasons 字段。
 */
function detectContentFilter(response: Record<string, unknown> | undefined): string | undefined {
  if (!response) return undefined;
  const json = JSON.stringify(response);
  if (/isMediaFilteredCount|aiMediaFilteredReasons|mediaFilteredCount|filteredReasons/i.test(json)) {
    const reasonMatch = json.match(/"(?:aiMediaFilteredReasons|filteredReasons)"\s*:\s*\[([^\]]*)\]/);
    const reasons = reasonMatch?.[1]?.replace(/"/g, '').trim() || '未知原因';
    return reasons;
  }
  return undefined;
}

type JobStore = {
  pending: Map<string, VeoJob | RunwayJob>;
  done: Map<string, Terminal>;
  stream: Map<string, ReadyToStream>;
};

/**
 * 用 globalThis 持久化任务 Map，避免 Next.js dev 模式下
 * 按需编译不同 API 路由时模块被重新实例化、内存状态丢失。
 */
const STORE_KEY = '__yongjue_video_jobs__';
function getStore(): JobStore {
  const g = globalThis as unknown as Record<string, JobStore | undefined>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = {
      pending: new Map(),
      done: new Map(),
      stream: new Map(),
    };
  }
  if (!g[STORE_KEY]!.stream) {
    g[STORE_KEY]!.stream = new Map();
  }
  return g[STORE_KEY]!;
}

const { pending, done, stream } = getStore();

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

/** 获取已就绪的 Google 视频 URI（供流式代理路由使用） */
export function getStreamInfo(jobId: string): ReadyToStream | undefined {
  return stream.get(jobId);
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
    const op = job.operation;
    const elapsedSec = Math.floor((Date.now() - job.created) / 1000);
    const opName = op.name;
    if (!opName) {
      pending.delete(jobId);
      const msg = 'Veo operation 缺少 name，无法轮询';
      done.set(jobId, { error: msg });
      return { status: 'error', message: msg };
    }

    let raw: RawLroResponse;
    try {
      console.log(`[video-job ${jobId.slice(0, 8)}] REST poll @ ${elapsedSec}s, name=${opName}`);
      raw = await pollVeoRest(job.apiKey, opName);
      console.log(`[video-job ${jobId.slice(0, 8)}] REST result: done=${raw.done}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const isTransient = /超时|timeout|aborted|ECONNRESET|fetch failed/i.test(message);
      console.warn(`[video-job ${jobId.slice(0, 8)}] REST poll error @ ${elapsedSec}s (transient=${isTransient}):`, message);
      if (isTransient) {
        return { status: 'pending' };
      }
      pending.delete(jobId);
      done.set(jobId, { error: message });
      return { status: 'error', message };
    }

    if (raw.done !== true) {
      return { status: 'pending' };
    }

    if (raw.error) {
      const msg = raw.error.message || JSON.stringify(raw.error);
      pending.delete(jobId);
      done.set(jobId, { error: `Veo 任务失败：${msg}` });
      return { status: 'error', message: `Veo 任务失败：${msg}` };
    }

    const uri = extractVideoUri(raw.response);
    const filtered = detectContentFilter(raw.response);
    if (!uri) {
      pending.delete(jobId);
      let msg: string;
      if (filtered) {
        msg = `⚠️ 视频被 Google 内容安全审核拦截：${filtered}\n\n建议：\n• 换用英文提示词（如 "Product showcase, rotating slowly"）\n• 尝试切换为 Veo 2.0 模型\n• 更换产品图片重试`;
      } else {
        const snippet = JSON.stringify(raw.response || raw).slice(0, 300);
        console.error(`[video-job ${jobId.slice(0, 8)}] done=true 但无视频 URI, 原始:`, snippet);
        msg = `Veo 完成但未返回视频 URI，请重试或更换模型。`;
      }
      done.set(jobId, { error: msg });
      return { status: 'error', message: msg };
    }

    const videoUrl = `/api/video/stream/${jobId}`;
    stream.set(jobId, { googleUri: uri, apiKey: job.apiKey });
    pending.delete(jobId);
    done.set(jobId, { videoUrl });
    console.log(`[video-job ${jobId.slice(0, 8)}] 视频就绪, 流式代理: ${videoUrl}`);
    return { status: 'done', videoUrl };
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
