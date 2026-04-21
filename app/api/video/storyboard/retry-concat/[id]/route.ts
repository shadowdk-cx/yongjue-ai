import { NextResponse } from 'next/server';
import { retryConcat } from '@/lib/storyboard-jobs';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  context: { params: { id: string } }
) {
  const { id } = context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: '缺少任务 ID' }, { status: 400 });
  }

  try {
    await retryConcat(id.trim());
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
