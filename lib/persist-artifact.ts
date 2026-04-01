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
 * - 优先写入 public/generated-images 或 public/generated-videos（由 Next 静态托管）
 * - 若只读盘或写入失败（常见于部分容器），回退到系统临时目录并通过 /api/artifact/ 读取
 *
 * 避免把数 MB 的 base64 塞进 JSON，导致 Zeabur/反代/浏览器在回传阶段失败（表现为「连续生成失败」）。
 */
export function persistDataUrlAsPublicUrl(dataUrl: string): string {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error('内部错误：仅支持 image/* 或 video/mp4 的 data URL');
  }
  const { buffer, mimeType, isVideo } = parsed;
  const ext = MIME_TO_EXT[mimeType] || (isVideo ? 'mp4' : 'png');
  const name = `${randomUUID()}.${ext}`;
  const subdir = isVideo ? 'generated-videos' : 'generated-images';
  const publicDir = join(process.cwd(), 'public', subdir);
  const publicPath = join(publicDir, name);

  try {
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(publicPath, buffer);
    return `/${subdir}/${name}`;
  } catch (first) {
    const code =
      first && typeof first === 'object' && 'code' in first
        ? String((first as NodeJS.ErrnoException).code)
        : '';
    try {
      mkdirSync(TMP_ARTIFACT_DIR, { recursive: true });
      const tmpPath = join(TMP_ARTIFACT_DIR, name);
      writeFileSync(tmpPath, buffer);
      console.warn(
        `[persist-artifact] public 写入失败 (${code || 'unknown'})，已改用临时目录：${tmpPath} → /api/artifact/${name}`
      );
      return `/api/artifact/${name}`;
    } catch (second) {
      const a = first instanceof Error ? first.message : String(first);
      const b = second instanceof Error ? second.message : String(second);
      throw new Error(
        `保存生成文件失败：public 目录异常（${a}）；临时目录也失败（${b}）。请检查容器磁盘权限或空间。`
      );
    }
  }
}
