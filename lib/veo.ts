import { GoogleGenAI, VideoGenerationReferenceType, type GenerateVideosOperation, type Video } from '@google/genai';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { withTimeout } from '@/lib/fetch-timeout';

const POLL_INTERVAL_MS = 10000;
const POLL_TIMEOUT_MS = 300000; // 5 min
/** 单次 Gemini 调用无响应则失败，避免轮询里永远 await 不返回 */
const SINGLE_CALL_TIMEOUT_MS = 180000; // 3 min（避免慢网误杀；总时长仍受 POLL_TIMEOUT_MS 限制）
/** 单次拉取 MP4：大文件 + 偶发连接挂起，略放宽；配合 AbortSignal 真正中断底层请求 */
const DOWNLOAD_TIMEOUT_MS = 360000; // 6 min
const DOWNLOAD_RETRIES = 3;
const DOWNLOAD_RETRY_GAP_MS = 4000;

function getClient(apiKey: string) {
  if (!apiKey?.trim()) throw new Error('Gemini API Key 未配置');
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

/** LRO 完成但带 error 时，避免当成成功去拉视频 */
function throwIfVideosOperationFailed(operation: {
  done?: boolean;
  error?: Record<string, unknown>;
}) {
  if (operation.done !== true || !operation.error) return;
  const e = operation.error;
  const msg = typeof e.message === 'string' ? e.message : JSON.stringify(e);
  throw new Error(`Veo 任务失败：${msg}`);
}

function dataUrlToImage(dataUrl: string): { imageBytes: string; mimeType: string } | null {
  if (!dataUrl?.startsWith('data:image/')) return null;
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
  if (!match) return null;
  return { mimeType: match[1], imageBytes: match[2] };
}

/**
 * 将 Veo 完成后的 video 转为 data:video/mp4;base64,...
 * - 若响应里已有 videoBytes，直接返回（避免再走 files.download 流式拉取，减少「第二次必卡死」类问题）
 * - 否则走 SDK download，并用 AbortSignal.timeout 中止挂起的连接；失败自动重试几次
 */
async function veoVideoToMp4DataUrl(ai: GoogleGenAI, video: Video | undefined): Promise<string> {
  if (!video) throw new Error('Veo 未返回视频');

  if (typeof video.videoBytes === 'string' && video.videoBytes.length > 0) {
    const mime =
      video.mimeType && video.mimeType.includes('/') ? video.mimeType : 'video/mp4';
    return `data:${mime};base64,${video.videoBytes}`;
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
    const dir = join(tmpdir(), `veo-dl-${Date.now()}-${randomBytes(6).toString('hex')}`);
    const outPath = join(dir, 'out.mp4');
    mkdirSync(dir, { recursive: true });
    try {
      const abortSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
      await ai.files.download({
        file: video,
        downloadPath: outPath,
        config: { abortSignal },
      });
      const buf = readFileSync(outPath);
      return `data:video/mp4;base64,${buf.toString('base64')}`;
    } catch (e) {
      lastErr = e;
      if (attempt < DOWNLOAD_RETRIES) {
        await new Promise((r) => setTimeout(r, DOWNLOAD_RETRY_GAP_MS));
      }
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  const raw = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const isTimeout =
    /超时|timeout|aborted|AbortError|TIMEOUT|ETIMEDOUT|ECONNRESET/i.test(raw);
  if (isTimeout) {
    throw new Error('下载生成视频超时，请稍后重试');
  }
  throw new Error(`下载生成视频失败：${raw}`);
}

/** 仅提交文生视频 LRO，供异步轮询（短连接 / 网关友好） */
export async function startVideoFromText(
  apiKey: string,
  model: string,
  prompt: string,
  config?: { aspectRatio?: '16:9' | '9:16' }
): Promise<GenerateVideosOperation> {
  const ai = getClient(apiKey);
  return await withTimeout(
    ai.models.generateVideos({
      model: model || 'veo-2.0-generate-001',
      prompt: prompt.trim().slice(0, 2000),
      config: config ? { aspectRatio: config.aspectRatio } : undefined,
    }),
    SINGLE_CALL_TIMEOUT_MS,
    '提交文生视频任务超时，请稍后重试'
  );
}

const ADVANCE_TIMEOUT_MS = 30_000;

type RawLroResponse = {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
    };
  };
};

/**
 * 绕过 SDK `getVideosOperation`（v1.45 有 bug：始终返回 done=undefined），
 * 直接调用 REST API 查询 LRO 状态。
 */
async function pollOperationRaw(apiKey: string, operationName: string): Promise<RawLroResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(ADVANCE_TIMEOUT_MS) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`查询 Veo 任务失败（HTTP ${res.status}）：${text.slice(0, 300)}`);
  }
  return (await res.json()) as RawLroResponse;
}

/** 拉取一次 Veo LRO 状态（每次 HTTP 请求只 await 一次，降低网关超时风险） */
export async function advanceVideoOperation(
  apiKey: string,
  operation: GenerateVideosOperation
): Promise<GenerateVideosOperation> {
  const opName = operation.name;
  if (!opName) {
    throw new Error('Veo operation 缺少 name，无法轮询');
  }

  const raw = await pollOperationRaw(apiKey, opName);

  if (raw.done === true) {
    if (raw.error) {
      const msg = raw.error.message || JSON.stringify(raw.error);
      throw new Error(`Veo 任务失败：${msg}`);
    }
    const samples = raw.response?.generateVideoResponse?.generatedSamples;
    const uri = samples?.[0]?.video?.uri;
    const op = operation as unknown as Record<string, unknown>;
    op.done = true;
    if (uri && !op.response) {
      op.response = {
        generatedVideos: (samples || []).map((s) => ({
          video: { uri: s.video?.uri },
        })),
      };
    }
    return operation;
  }

  return operation;
}

/**
 * 假定 operation.done === true：校验 error、下载首段视频为 data URL
 */
export async function completeVideoOperationToDataUrl(
  apiKey: string,
  operation: GenerateVideosOperation
): Promise<string> {
  throwIfVideosOperationFailed(operation);
  const ai = getClient(apiKey);
  const video = operation.response?.generatedVideos?.[0]?.video;
  return veoVideoToMp4DataUrl(ai, video);
}

/** 文生视频，返回 base64 的 data URL（video/mp4） */
export async function generateVideoFromText(
  apiKey: string,
  model: string,
  prompt: string,
  config?: { aspectRatio?: '16:9' | '9:16' }
): Promise<string> {
  let operation = await startVideoFromText(apiKey, model, prompt, config);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (operation.done !== true) {
    if (Date.now() > deadline) throw new Error('视频生成超时');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    operation = await advanceVideoOperation(apiKey, operation);
  }

  return completeVideoOperationToDataUrl(apiKey, operation);
}

function isVeo31Family(model: string) {
  const m = (model || '').toLowerCase();
  return m.includes('veo-3.1') || m.includes('veo-3');
}

function buildImageToVideoOperationParams(
  model: string,
  prompt: string,
  imageDataUrl: string | string[],
  config?: { aspectRatio?: '16:9' | '9:16' }
): Parameters<GoogleGenAI['models']['generateVideos']>[0] {
  const urls = (Array.isArray(imageDataUrl) ? imageDataUrl : [imageDataUrl]).filter(
    (u): u is string => typeof u === 'string' && u.startsWith('data:image/')
  );
  const images = urls.map((u) => dataUrlToImage(u)).filter(Boolean) as NonNullable<ReturnType<typeof dataUrlToImage>>[];
  if (images.length === 0) throw new Error('请至少上传一张有效图片');

  const basePrompt =
    prompt?.trim()?.slice(0, 2000) || 'Product shot, subtle motion, professional e-commerce style.';
  const m = model || 'veo-2.0-generate-001';
  const aspectCfg = config?.aspectRatio ? { aspectRatio: config.aspectRatio } : undefined;

  if (images.length >= 2 && isVeo31Family(m)) {
    const refs = images.slice(0, 3).map((img) => ({
      image: { imageBytes: img.imageBytes, mimeType: img.mimeType },
      referenceType: VideoGenerationReferenceType.ASSET,
    }));
    const multiHint =
      '【多图参考】用户上传了同一产品的多张参考图（不同角度/细节），请综合保持产品外观、材质与比例一致，生成真实可信的电商展示视频。';
    return {
      model: m,
      prompt: `${multiHint}\n\n${basePrompt}`,
      config: {
        ...aspectCfg,
        referenceImages: refs,
      },
    } as Parameters<GoogleGenAI['models']['generateVideos']>[0];
  }
  const single = images[0];
  const extra =
    images.length > 1 && !isVeo31Family(m)
      ? `\n\n【说明】用户还提供了 ${images.length - 1} 张同产品的其它角度参考图，请在视频中尽量保持与主图一致的产品真实性。`
      : '';
  return {
    model: m,
    prompt: `${basePrompt}${extra}`,
    image: { imageBytes: single.imageBytes, mimeType: single.mimeType },
    config: aspectCfg,
  } as Parameters<GoogleGenAI['models']['generateVideos']>[0];
}

/** 仅提交图生视频 LRO */
export async function startVideoFromImage(
  apiKey: string,
  model: string,
  prompt: string,
  imageDataUrl: string | string[],
  config?: { aspectRatio?: '16:9' | '9:16' }
): Promise<GenerateVideosOperation> {
  const ai = getClient(apiKey);
  const params = buildImageToVideoOperationParams(model, prompt, imageDataUrl, config);
  return await withTimeout(
    ai.models.generateVideos(params),
    SINGLE_CALL_TIMEOUT_MS,
    '提交图生视频任务超时，请稍后重试'
  );
}

/** 图生视频，返回 base64 的 data URL（video/mp4）。支持多张垫图：Veo 3.1 最多 3 张 referenceImages；其它模型仅用第一张。 */
export async function generateVideoFromImage(
  apiKey: string,
  model: string,
  prompt: string,
  imageDataUrl: string | string[],
  config?: { aspectRatio?: '16:9' | '9:16' }
): Promise<string> {
  let operation = await startVideoFromImage(apiKey, model, prompt, imageDataUrl, config);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (operation.done !== true) {
    if (Date.now() > deadline) throw new Error('视频生成超时');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    operation = await advanceVideoOperation(apiKey, operation);
  }

  return completeVideoOperationToDataUrl(apiKey, operation);
}
