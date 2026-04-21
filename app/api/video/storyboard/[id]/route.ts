import { NextResponse } from 'next/server';
import { getStoryboardStatus } from '@/lib/storyboard-jobs';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: { id: string } }
) {
  const { id } = context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: '缺少任务 ID' }, { status: 400 });
  }

  const status = getStoryboardStatus(id.trim());
  if (!status) {
    return NextResponse.json({ error: '任务不存在或已过期' }, { status: 404 });
  }

  return NextResponse.json(status);
}
