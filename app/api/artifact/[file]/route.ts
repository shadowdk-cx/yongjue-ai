import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { TMP_ARTIFACT_DIR } from '@/lib/persist-artifact';

/** 仅允许服务端自己生成的 UUID 文件名，避免路径穿越 */
const SAFE_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|gif|mp4)$/i;

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
};

export async function GET(_req: Request, context: { params: { file: string } }) {
  const raw = context.params.file || '';
  const file = decodeURIComponent(raw);
  if (!SAFE_FILE.test(file)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const cwd = process.cwd();
  const candidates = [
    join(cwd, 'public', 'generated-images', file),
    join(cwd, 'public', 'generated-videos', file),
    join(TMP_ARTIFACT_DIR, file),
  ];

  for (const abs of candidates) {
    if (!existsSync(abs)) continue;
    try {
      const buf = readFileSync(abs);
      const ext = (file.split('.').pop() || '').toLowerCase();
      const ct = EXT_MIME[ext] || 'application/octet-stream';
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch {
      /* try next path */
    }
  }

  return new NextResponse('Not Found', { status: 404 });
}
