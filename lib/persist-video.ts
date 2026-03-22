import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * 将 Veo 返回的 data:video/mp4;base64,... 落盘到 public，避免 JSON 里塞几十 MB base64
 * 导致浏览器 parse 卡死、界面一直「生成中」。
 */
export function persistMp4DataUrlToPublic(dataUrl: string): string {
  const m = dataUrl.match(/^data:video\/mp4;base64,(.+)$/i);
  if (!m) {
    throw new Error('内部错误：视频格式不是预期的 MP4 data URL');
  }
  const buf = Buffer.from(m[1], 'base64');
  const dir = join(process.cwd(), 'public', 'generated-videos');
  mkdirSync(dir, { recursive: true });
  const name = `${randomUUID()}.mp4`;
  writeFileSync(join(dir, name), buf);
  return `/generated-videos/${name}`;
}
