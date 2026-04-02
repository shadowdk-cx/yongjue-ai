import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/** 与 app/api/artifact/[file]/route.ts 中校验规则一致 */
export const TMP_ARTIFACT_DIR = join(tmpdir(), 'yongjue-ai-artifacts');

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
};

function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string; isVideo: boolean } | null {
  const m = dataUrl.match(/^data:(image\/[a-z+]+|video\/mp4);base64,(.+)$/i);
  if (!m) return null;
  const mimeType = m[1].toLowerCase();
  try {
    const buffer = Buffer.from(m[2], 'base64');
    return { buffer, mimeType, isVideo: mimeType.startsWith('video/') };
  } catch {
    return null;
  }
}

/**
 * 将 data URL（图片或 MP4）落盘并返回可给浏览器用的相对 URL。
 * 统一写入系统临时目录，通过 /api/artifact/[file] 动态路由提供服务。
 * Next.js 生产模式下 public/ 目录不会动态发现新文件，所以不能依赖静态服务。
 */
export function persistDataUrlAsPublicUrl(dataUrl: string): string {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error('内部错误：仅支持 image/* 或 video/mp4 的 data URL');
  }
  const { buffer, mimeType, isVideo } = parsed;
  const ext = MIME_TO_EXT[mimeType] || (isVideo ? 'mp4' : 'png');
  const name = `${randomUUID()}.${ext}`;

  try {
    mkdirSync(TMP_ARTIFACT_DIR, { recursive: true });
    const filePath = join(TMP_ARTIFACT_DIR, name);
    writeFileSync(filePath, buffer);
    return `/api/artifact/${name}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`保存生成文件失败：${msg}。请检查磁盘空间。`);
  }
}
