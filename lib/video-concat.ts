import ffmpeg from 'fluent-ffmpeg';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { TMP_ARTIFACT_DIR } from '@/lib/persist-artifact';

export function resolveFfmpegPath(): string {
  const candidates = [
    join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const sys = execSync('which ffmpeg 2>/dev/null || where ffmpeg 2>nul', { encoding: 'utf-8' }).trim();
    if (sys && existsSync(sys)) return sys;
  } catch { /* not found */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require('ffmpeg-static') as string;
    if (staticPath && existsSync(staticPath)) return staticPath;
  } catch { /* not available */ }
  throw new Error('找不到 ffmpeg，请确保已安装 ffmpeg-static 或系统已安装 ffmpeg');
}

const ffmpegPath = resolveFfmpegPath();
ffmpeg.setFfmpegPath(ffmpegPath);

export type ConcatClip = {
  source: string;
};

/**
 * 将多个 MP4 片段拼接成一个完整视频。
 * 先尝试 stream-copy（快速），失败后 fallback 到重编码（兼容不同编码参数的片段）。
 */
export async function concatVideos(
  clips: ConcatClip[],
): Promise<string> {
  if (clips.length === 0) throw new Error('没有可拼接的视频片段');

  mkdirSync(TMP_ARTIFACT_DIR, { recursive: true });
  const workDir = join(TMP_ARTIFACT_DIR, `concat-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });

  const localPaths: string[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const dest = join(workDir, `clip-${String(i).padStart(3, '0')}.mp4`);

    if (clip.source.startsWith('http://') || clip.source.startsWith('https://')) {
      const res = await fetch(clip.source, { cache: 'no-store' });
      if (!res.ok) throw new Error(`下载片段 ${i + 1} 失败 (HTTP ${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(dest, buf);
    } else if (existsSync(clip.source)) {
      const { copyFileSync } = await import('fs');
      copyFileSync(clip.source, dest);
    } else {
      throw new Error(`片段 ${i + 1} 不存在: ${clip.source}`);
    }

    const sz = statSync(dest).size;
    if (sz < 1000) {
      throw new Error(`片段 ${i + 1} 文件过小 (${sz} bytes)，可能下载不完整`);
    }
    localPaths.push(dest);
  }

  const listFile = join(workDir, 'concat.txt');
  const listContent = localPaths.map((p) => `file '${p}'`).join('\n');
  writeFileSync(listFile, listContent);

  const outputName = `${randomUUID()}.mp4`;
  const outputPath = join(TMP_ARTIFACT_DIR, outputName);

  try {
    await runFfmpegConcat(listFile, outputPath, false);
    console.log('[video-concat] stream-copy 成功');
  } catch (copyErr) {
    console.warn('[video-concat] stream-copy 失败，fallback 到重编码:', (copyErr as Error).message);
    try { unlinkSync(outputPath); } catch { /* ignore */ }
    await runFfmpegConcat(listFile, outputPath, true);
    console.log('[video-concat] 重编码拼接成功');
  }

  for (const p of localPaths) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
  try { unlinkSync(listFile); } catch { /* ignore */ }
  try {
    const { rmdirSync } = await import('fs');
    rmdirSync(workDir);
  } catch { /* ignore */ }

  return outputName;
}

function runFfmpegConcat(listFile: string, outputPath: string, reencode: boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stderrLog = '';
    const cmd = ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0']);

    if (reencode) {
      cmd.outputOptions([
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
      ]);
    } else {
      cmd.outputOptions(['-c', 'copy', '-movflags', '+faststart', '-y']);
    }

    cmd
      .output(outputPath)
      .on('stderr', (line: string) => { stderrLog += line + '\n'; })
      .on('end', () => resolve())
      .on('error', (err: Error) => {
        console.error(`[video-concat] ffmpeg stderr (reencode=${reencode}):\n${stderrLog.slice(-1000)}`);
        reject(new Error(`ffmpeg 拼接失败 (${reencode ? '重编码' : '流拷贝'}): ${err.message}`));
      })
      .run();
  });
}
