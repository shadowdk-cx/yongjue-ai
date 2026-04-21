import { NextRequest, NextResponse } from 'next/server';
import { getImageJob } from '@/lib/image-jobs';

export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = String(params?.id || '').trim();
  if (!id) {
    return NextResponse.json({ error: '缺少 jobId' }, { status: 400 });
  }
  const job = getImageJob(id);
  if (!job) {
    return NextResponse.json({ error: '任务不存在或已过期' }, { status: 404 });
  }
  if (job.status === 'succeeded') {
    return NextResponse.json({ status: 'succeeded', url: job.url });
  }
  if (job.status === 'failed') {
    return NextResponse.json({ status: 'failed', error: job.error || '生图失败' });
  }
  return NextResponse.json({ status: job.status });
}
