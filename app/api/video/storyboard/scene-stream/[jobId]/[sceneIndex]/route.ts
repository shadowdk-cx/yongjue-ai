import { NextResponse } from 'next/server';
import { getSceneStreamInfo } from '@/lib/storyboard-jobs';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: { jobId: string; sceneIndex: string } }
) {
  const { jobId, sceneIndex: idxStr } = context.params;
  const idx = parseInt(idxStr, 10);
  if (!jobId || isNaN(idx)) {
    return new NextResponse('参数无效', { status: 400 });
  }

  const info = getSceneStreamInfo(jobId, idx);
  if (!info) {
    return new NextResponse('场景视频不存在', { status: 404 });
  }

  const sep = info.googleUri.includes('?') ? '&' : '?';
  const url = `${info.googleUri}${sep}key=${encodeURIComponent(info.apiKey)}`;

  try {
    const upstream = await fetch(url, { cache: 'no-store' });
    if (!upstream.ok) {
      return new NextResponse(`下载失败 (${upstream.status})`, { status: 502 });
    }
    const headers = new Headers({
      'Content-Type': upstream.headers.get('Content-Type') || 'video/mp4',
      'Cache-Control': 'public, max-age=3600',
    });
    const cl = upstream.headers.get('Content-Length');
    if (cl) headers.set('Content-Length', cl);
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`流代理失败: ${msg}`, { status: 502 });
  }
}
