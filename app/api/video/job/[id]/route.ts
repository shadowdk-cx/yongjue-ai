import { NextRequest, NextResponse } from 'next/server';
import { pollVideoJob } from '@/lib/video-jobs';

export const maxDuration = 120;

export async function GET(_req: NextRequest, context: { params: { id: string } }) {
  const { id } = context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: '缺少任务 ID' }, { status: 400 });
  }
  try {
    const result = await pollVideoJob(id.trim());
    if (result.status === 'done') {
      return NextResponse.json({ status: 'done', videoUrl: result.videoUrl, url: result.videoUrl });
    }
    if (result.status === 'error') {
      return NextResponse.json({ status: 'error', error: result.message }, { status: 500 });
    }
    return NextResponse.json({ status: 'pending' });
  } catch (e) {
    const message = e instanceof Error ? e.message : '轮询失败';
    return NextResponse.json({ status: 'error', error: message }, { status: 500 });
  }
}
