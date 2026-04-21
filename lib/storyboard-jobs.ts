import { randomUUID } from 'crypto';
import { startVideoFromImage, startVideoFromText } from '@/lib/veo';
import { translatePromptToEnglish } from '@/lib/translate-prompt';
import { concatVideos, type ConcatClip } from '@/lib/video-concat';
import { TMP_ARTIFACT_DIR } from '@/lib/persist-artifact';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export type SceneInput = {
  description: string;
  durationSec: number;
  cameraMove?: string;
  needsProductImage: boolean;
  productImageDataUrl?: string;
  /** 经过产品替换的原始帧——优先用于 Veo image-to-video 输入 */
  editedFrameDataUrl?: string;
  background?: string;
  lighting?: string;
  colorGrading?: string;
  composition?: string;
  textOverlay?: string | null;
  transition?: string;
  props?: string;
  audioMood?: string;
  subjectAction?: string;
};

export type SceneStatus = 'pending' | 'submitting' | 'generating' | 'done' | 'error';

type SceneJob = {
  sceneIndex: number;
  status: SceneStatus;
  operationName?: string;
  googleVideoUri?: string;
  streamUrl?: string;
  error?: string;
};

type StoryboardJob = {
  id: string;
  apiKey: string;
  model: string;
  scenes: SceneInput[];
  sceneJobs: SceneJob[];
  status: 'generating' | 'concatenating' | 'done' | 'error';
  finalVideoUrl?: string;
  error?: string;
  created: number;
  aspectRatio?: '16:9' | '9:16';
  /** true = 保留分镜描述的原始语言，不强制翻译成英文 */
  keepOriginalLanguage?: boolean;
};

type StoryboardStore = {
  jobs: Map<string, StoryboardJob>;
};

const STORE_KEY = '__yongjue_storyboard_jobs__';
function getStore(): StoryboardStore {
  const g = globalThis as unknown as Record<string, StoryboardStore | undefined>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { jobs: new Map() };
  }
  return g[STORE_KEY]!;
}

const store = getStore();

const VEO_POLL_TIMEOUT_MS = 30_000;

async function pollVeoRest(apiKey: string, operationName: string): Promise<Record<string, unknown>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(VEO_POLL_TIMEOUT_MS) });
  const body = await res.text();
  if (!res.ok) throw new Error(`Veo 查询失败 (HTTP ${res.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body) as Record<string, unknown>;
}

function extractVideoUri(response: unknown): string | undefined {
  if (!response) return undefined;
  const json = JSON.stringify(response);
  const match = json.match(/"uri"\s*:\s*"(https:\/\/[^"]+)"/);
  return match?.[1];
}

/**
 * 注册一个新的分镜批量生成任务，并在后台开始串行生成。
 */
export function createStoryboardJob(
  apiKey: string,
  model: string,
  scenes: SceneInput[],
  aspectRatio?: '16:9' | '9:16',
  keepOriginalLanguage?: boolean
): string {
  const id = randomUUID();
  const sceneJobs: SceneJob[] = scenes.map((_, i) => ({
    sceneIndex: i,
    status: 'pending' as SceneStatus,
  }));

  const job: StoryboardJob = {
    id,
    apiKey,
    model: model || 'veo-2.0-generate-001',
    scenes,
    sceneJobs,
    status: 'generating',
    created: Date.now(),
    aspectRatio,
    keepOriginalLanguage,
  };

  store.jobs.set(id, job);

  processStoryboard(id).catch((e) => {
    const j = store.jobs.get(id);
    if (j) {
      j.status = 'error';
      j.error = e instanceof Error ? e.message : String(e);
    }
  });

  return id;
}

const MAX_CONTENT_FILTER_RETRIES = 3;

function isContentFilterError(msg: string): boolean {
  return /内容安全审核拦截|isMediaFilteredCount|aiMediaFilteredReasons|content.?filter|safety.?filter|blocked/i.test(msg);
}

/**
 * Prompt 安全前缀：明确告诉 Veo 这是合法电商内容
 */
const SAFETY_PREFIX = 'Professional commercial product advertisement video for e-commerce. Safe for all audiences. ';

/**
 * 逐级简化 prompt，每次去掉更多可能触发安全审核的细节
 */
function simplifyPromptForRetry(scene: SceneInput, retryLevel: number): string {
  if (retryLevel <= 1) {
    const parts: string[] = [SAFETY_PREFIX];
    parts.push(scene.description);
    if (scene.cameraMove) parts.push(`Camera: ${scene.cameraMove}`);
    if (scene.background) parts.push(`Background: ${scene.background}`);
    if (scene.composition) parts.push(`Framing: ${scene.composition}`);
    parts.push('High quality product showcase video.');
    return parts.join('. ');
  }

  return `${SAFETY_PREFIX}Product showcase video. ${scene.description.slice(0, 200)}. Clean studio style, professional lighting, smooth camera movement.`;
}

async function submitAndWaitScene(
  job: { apiKey: string; model: string; aspectRatio?: '16:9' | '9:16'; keepOriginalLanguage?: boolean },
  scene: SceneInput,
  prompt: string,
  useImage: boolean,
  jobId: string,
  sceneIndex: number,
): Promise<string> {
  const config = job.aspectRatio ? { aspectRatio: job.aspectRatio } : undefined;

  // 优先级：编辑后的帧 > 产品图 > 纯文字
  const imageSource = useImage
    ? (scene.editedFrameDataUrl || (scene.needsProductImage && scene.productImageDataUrl) || null)
    : null;

  let operation;
  if (imageSource) {
    operation = await startVideoFromImage(job.apiKey, job.model, prompt, imageSource, config);
  } else {
    operation = await startVideoFromText(job.apiKey, job.model, prompt, config);
  }

  if (!operation.name) throw new Error('Veo 未返回 operation name');
  console.log(`[storyboard ${jobId.slice(0, 8)}] scene ${sceneIndex + 1} submitted: ${operation.name}`);

  return await waitForSceneCompletion(job.apiKey, operation.name, jobId, sceneIndex);
}

async function processStoryboard(jobId: string) {
  const job = store.jobs.get(jobId);
  if (!job) return;

  for (let i = 0; i < job.scenes.length; i++) {
    const scene = job.scenes[i];
    const sj = job.sceneJobs[i];

    sj.status = 'submitting';
    try {
      const rawPrompt = buildScenePrompt(scene);
      const enPrompt = job.keepOriginalLanguage
        ? rawPrompt
        : await translatePromptToEnglish(job.apiKey, rawPrompt);

      let uri: string | undefined;
      let lastError: string = '';

      // 第 0 次：完整 prompt + 图片
      try {
        sj.status = 'generating';
        uri = await submitAndWaitScene(job, scene, enPrompt, true, jobId, i);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`[storyboard ${jobId.slice(0, 8)}] scene ${i + 1} attempt 0 failed: ${lastError}`);
      }

      // 被内容安全拦截时自动重试
      for (let retry = 1; retry <= MAX_CONTENT_FILTER_RETRIES && !uri && isContentFilterError(lastError); retry++) {
        console.log(`[storyboard ${jobId.slice(0, 8)}] scene ${i + 1} content-filter retry ${retry}/${MAX_CONTENT_FILTER_RETRIES}`);
        sj.error = undefined;
        sj.status = 'submitting';

        const simpleRaw = simplifyPromptForRetry(scene, retry);
        const simplePrompt = job.keepOriginalLanguage
          ? simpleRaw
          : await translatePromptToEnglish(job.apiKey, simpleRaw);

        // 最后一次重试用纯文字（不带产品图），图片有时是触发源
        const useImage = retry < MAX_CONTENT_FILTER_RETRIES;

        try {
          sj.status = 'generating';
          uri = await submitAndWaitScene(job, scene, simplePrompt, useImage, jobId, i);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          console.warn(`[storyboard ${jobId.slice(0, 8)}] scene ${i + 1} retry ${retry} failed: ${lastError}`);
        }
      }

      if (uri) {
        sj.googleVideoUri = uri;
        sj.streamUrl = `/api/video/storyboard/scene-stream/${jobId}/${i}`;
        sj.status = 'done';
        console.log(`[storyboard ${jobId.slice(0, 8)}] scene ${i + 1} done`);
      } else {
        sj.status = 'error';
        sj.error = lastError;
        console.error(`[storyboard ${jobId.slice(0, 8)}] scene ${i + 1} all attempts failed: ${lastError}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sj.status = 'error';
      sj.error = msg;
      console.error(`[storyboard ${jobId.slice(0, 8)}] scene ${i + 1} error:`, msg);
    }
  }

  const successScenes = job.sceneJobs.filter((s) => s.status === 'done' && s.googleVideoUri);
  if (successScenes.length === 0) {
    job.status = 'error';
    job.error = '所有场景均生成失败';
    return;
  }

  job.status = 'concatenating';
  console.log(`[storyboard ${jobId.slice(0, 8)}] ${successScenes.length}/${job.scenes.length} scenes done, concatenating...`);

  try {
    const clips: ConcatClip[] = [];
    for (const sj of successScenes) {
      const uri = sj.googleVideoUri!;
      const sep = uri.includes('?') ? '&' : '?';
      const fullUrl = `${uri}${sep}key=${encodeURIComponent(job.apiKey)}`;

      mkdirSync(TMP_ARTIFACT_DIR, { recursive: true });
      const tmpFile = join(TMP_ARTIFACT_DIR, `scene-${randomUUID()}.mp4`);
      const res = await fetch(fullUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`下载场景视频失败 (HTTP ${res.status})`);
      writeFileSync(tmpFile, Buffer.from(await res.arrayBuffer()));
      clips.push({ source: tmpFile });
    }

    const outputName = await concatVideos(clips);
    job.finalVideoUrl = `/api/artifact/${outputName}`;
    job.status = 'done';
    console.log(`[storyboard ${jobId.slice(0, 8)}] final video: ${job.finalVideoUrl}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    job.status = 'error';
    job.error = `拼接失败: ${msg}`;
    console.error(`[storyboard ${jobId.slice(0, 8)}] concat error:`, msg);
  }
}

async function waitForSceneCompletion(
  apiKey: string,
  operationName: string,
  jobId: string,
  sceneIndex: number
): Promise<string> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));

    try {
      const raw = await pollVeoRest(apiKey, operationName);
      if ((raw as { done?: boolean }).done === true) {
        if ((raw as { error?: unknown }).error) {
          const err = (raw as { error?: { message?: string } }).error;
          throw new Error(`Veo 场景 ${sceneIndex + 1} 失败: ${err?.message || JSON.stringify(err)}`);
        }
        const uri = extractVideoUri((raw as { response?: unknown }).response);
        if (!uri) {
          const snippet = JSON.stringify(raw).slice(0, 300);
          const isFiltered = /isMediaFilteredCount|aiMediaFilteredReasons/i.test(snippet);
          if (isFiltered) {
            throw new Error(`场景 ${sceneIndex + 1} 被 Google 内容安全审核拦截，请修改场景描述后重试`);
          }
          throw new Error(`场景 ${sceneIndex + 1} 完成但未返回视频`);
        }
        return uri;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/超时|timeout|aborted|ECONNRESET|fetch failed/i.test(msg)) {
        continue;
      }
      throw e;
    }
  }
  throw new Error(`场景 ${sceneIndex + 1} 生成超时（5分钟）`);
}

function buildScenePrompt(scene: SceneInput): string {
  const parts: string[] = [];

  if (scene.subjectAction) {
    parts.push(scene.subjectAction);
  } else {
    parts.push(scene.description);
  }

  if (scene.background) {
    parts.push(`Background: ${scene.background}`);
  }

  if (scene.composition) {
    parts.push(`Framing: ${scene.composition}`);
  }

  if (scene.cameraMove) {
    parts.push(`Camera: ${scene.cameraMove}`);
  }

  if (scene.lighting) {
    parts.push(`Lighting: ${scene.lighting}`);
  }

  if (scene.colorGrading) {
    parts.push(`Color grading: ${scene.colorGrading}`);
  }

  if (scene.props) {
    parts.push(`Props: ${scene.props}`);
  }

  if (scene.textOverlay) {
    parts.push(`Text overlay: "${scene.textOverlay}"`);
  }

  if (scene.transition) {
    parts.push(`Transition: ${scene.transition}`);
  }

  if (scene.description && scene.subjectAction) {
    parts.push(`Context: ${scene.description}`);
  }

  parts.push('Cinematic e-commerce product advertisement, professional quality, smooth motion, high resolution. Safe for all audiences.');

  return SAFETY_PREFIX + parts.join('. ');
}

/** 获取分镜任务的当前状态 */
export function getStoryboardStatus(jobId: string): {
  status: StoryboardJob['status'];
  scenes: Array<{ index: number; status: SceneStatus; error?: string; streamUrl?: string }>;
  finalVideoUrl?: string;
  error?: string;
} | null {
  const job = store.jobs.get(jobId);
  if (!job) return null;
  return {
    status: job.status,
    scenes: job.sceneJobs.map((sj) => ({
      index: sj.sceneIndex,
      status: sj.status,
      error: sj.error,
      streamUrl: sj.status === 'done' ? sj.streamUrl : undefined,
    })),
    finalVideoUrl: job.finalVideoUrl,
    error: job.error,
  };
}

/** 重新拼接已完成的场景（不重新生成） */
export async function retryConcat(jobId: string): Promise<void> {
  const job = store.jobs.get(jobId);
  if (!job) throw new Error('任务不存在');

  const successScenes = job.sceneJobs.filter((s) => s.status === 'done' && s.googleVideoUri);
  if (successScenes.length === 0) throw new Error('没有已完成的场景可拼接');

  job.status = 'concatenating';
  job.error = undefined;
  job.finalVideoUrl = undefined;

  try {
    const clips: ConcatClip[] = [];
    for (const sj of successScenes) {
      const uri = sj.googleVideoUri!;
      const sep = uri.includes('?') ? '&' : '?';
      const fullUrl = `${uri}${sep}key=${encodeURIComponent(job.apiKey)}`;

      mkdirSync(TMP_ARTIFACT_DIR, { recursive: true });
      const tmpFile = join(TMP_ARTIFACT_DIR, `scene-${randomUUID()}.mp4`);
      const res = await fetch(fullUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`下载场景视频失败 (HTTP ${res.status})`);
      writeFileSync(tmpFile, Buffer.from(await res.arrayBuffer()));
      clips.push({ source: tmpFile });
    }

    const outputName = await concatVideos(clips);
    job.finalVideoUrl = `/api/artifact/${outputName}`;
    job.status = 'done';
    console.log(`[storyboard ${jobId.slice(0, 8)}] retry concat done: ${job.finalVideoUrl}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    job.status = 'error';
    job.error = `拼接失败: ${msg}`;
    console.error(`[storyboard ${jobId.slice(0, 8)}] retry concat error:`, msg);
  }
}

/** 获取某个场景的 Google 视频 URI（供流式代理） */
export function getSceneStreamInfo(jobId: string, sceneIndex: number): { googleUri: string; apiKey: string } | undefined {
  const job = store.jobs.get(jobId);
  if (!job) return undefined;
  const sj = job.sceneJobs[sceneIndex];
  if (!sj?.googleVideoUri) return undefined;
  return { googleUri: sj.googleVideoUri, apiKey: job.apiKey };
}
