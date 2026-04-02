import { NextResponse } from 'next/server';
import { getStreamInfo } from '@/lib/video-jobs';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * 流式代理：从 Google CDN 拉取视频并直接 pipe 给浏览器。
 * 避免先下载到服务器磁盘（大文件 + body 超时）和暴露 API Key。
 */
export async function GET(
  _req: Request,
  context: { params: { id: string } }
) {
  const { id } = context.params;
  if (!id?.trim()) {
    return new NextResponse('缺少任务 ID', { status: 400 });
  }

  const info = getStreamInfo(id.trim());
  if (!info) {
    return new NextResponse('视频不存在或已过期', { status: 404 });
  }

  const sep = info.googleUri.includes('?') ? '&' : '?';
  const url = `${info.googleUri}${sep}key=${encodeURIComponent(info.apiKey)}`;

  try {
    const upstream = await fetch(url, { cache: 'no-store' });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return new NextResponse(`Google 视频下载失败 (${upstream.status}): ${text.slice(0, 200)}`, { status: 502 });
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
    console.error(`[video-stream ${id.slice(0, 8)}] 代理失败:`, msg);
    return new NextResponse(`视频流代理失败: ${msg}`, { status: 502 });
  }
}
