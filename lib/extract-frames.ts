import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { resolveFfmpegPath } from '@/lib/video-concat';

/**
 * 从 data:video URL 提取指定时间戳的帧，返回 JPEG base64 data URL 数组。
 */
export function extractFramesFromDataUrl(
  videoDataUrl: string,
  timestamps: number[]
): string[] {
  const match = videoDataUrl.match(/^data:video\/[a-z0-9]+;base64,(.+)$/i);
  if (!match) throw new Error('视频格式无效');

  const workDir = join(tmpdir(), `frames-${randomBytes(6).toString('hex')}`);
  mkdirSync(workDir, { recursive: true });
  const videoPath = join(workDir, 'input.mp4');

  try {
    writeFileSync(videoPath, Buffer.from(match[1], 'base64'));
    return extractFrames(videoPath, timestamps, workDir);
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function extractFrames(
  videoPath: string,
  timestamps: number[],
  workDir: string
): string[] {
  const ffmpeg = resolveFfmpegPath();
  const results: string[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const outPath = join(workDir, `frame_${i}.jpg`);
    const ts = Math.max(0, timestamps[i]);

    try {
      execFileSync(ffmpeg, [
        '-ss', String(ts),
        '-i', videoPath,
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
        outPath,
      ], { timeout: 15000, stdio: 'pipe' });

      if (existsSync(outPath)) {
        const buf = readFileSync(outPath);
        results.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
      } else {
        results.push('');
      }
    } catch {
      results.push('');
    }
  }

  return results;
}
