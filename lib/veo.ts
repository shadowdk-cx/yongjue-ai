import { GoogleGenAI } from '@google/genai';
import { readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const POLL_INTERVAL_MS = 10000;
const POLL_TIMEOUT_MS = 300000; // 5 min

function getClient(apiKey: string) {
  if (!apiKey?.trim()) throw new Error('Gemini API Key 未配置');
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

function dataUrlToImage(dataUrl: string): { imageBytes: string; mimeType: string } | null {
  if (!dataUrl?.startsWith('data:image/')) return null;
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
  if (!match) return null;
  return { mimeType: match[1], imageBytes: match[2] };
}

/** 文生视频，返回 base64 的 data URL（video/mp4） */
export async function generateVideoFromText(
  apiKey: string,
  model: string,
  prompt: string,
  config?: { aspectRatio?: '16:9' | '9:16' }
): Promise<string> {
  const ai = getClient(apiKey);
  let operation = await ai.models.generateVideos({
    model: model || 'veo-2.0-generate-001',
    prompt: prompt.trim().slice(0, 2000),
    config: config ? { aspectRatio: config.aspectRatio } : undefined,
  });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (!operation.done) {
    if (Date.now() > deadline) throw new Error('视频生成超时');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error('Veo 未返回视频');

  const dir = join(tmpdir(), 'veo-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, 'out.mp4');
  try {
    await ai.files.download({ file: video, downloadPath: outPath });
    const buf = readFileSync(outPath);
    const b64 = buf.toString('base64');
    return `data:video/mp4;base64,${b64}`;
  } finally {
    try {
      unlinkSync(outPath);
    } catch {}
  }
}

/** 图生视频，返回 base64 的 data URL（video/mp4） */
export async function generateVideoFromImage(
  apiKey: string,
  model: string,
  prompt: string,
  imageDataUrl: string,
  config?: { aspectRatio?: '16:9' | '9:16' }
): Promise<string> {
  const image = dataUrlToImage(imageDataUrl);
  if (!image) throw new Error('请上传一张有效图片');

  const ai = getClient(apiKey);
  let operation = await ai.models.generateVideos({
    model: model || 'veo-2.0-generate-001',
    prompt: prompt?.trim()?.slice(0, 2000) || 'Product shot, subtle motion, professional e-commerce style.',
    image: { imageBytes: image.imageBytes, mimeType: image.mimeType },
    config: config ? { aspectRatio: config.aspectRatio } : undefined,
  });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (!operation.done) {
    if (Date.now() > deadline) throw new Error('视频生成超时');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error('Veo 未返回视频');

  const dir = join(tmpdir(), 'veo-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, 'out.mp4');
  try {
    await ai.files.download({ file: video, downloadPath: outPath });
    const buf = readFileSync(outPath);
    const b64 = buf.toString('base64');
    return `data:video/mp4;base64,${b64}`;
  } finally {
    try {
      unlinkSync(outPath);
    } catch {}
  }
}
