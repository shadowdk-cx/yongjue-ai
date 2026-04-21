import { NextRequest, NextResponse } from 'next/server';
import { createStoryboardJob, type SceneInput } from '@/lib/storyboard-jobs';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, model, scenes, aspectRatio, keepOriginalLanguage } = body as {
      apiKey?: string;
      model?: string;
      scenes?: SceneInput[];
      aspectRatio?: '16:9' | '9:16';
      keepOriginalLanguage?: boolean;
    };

    if (!apiKey?.trim()) {
      return NextResponse.json({ error: '请填写 Gemini API Key' }, { status: 400 });
    }
    if (!scenes || scenes.length === 0) {
      return NextResponse.json({ error: '请至少提供一个分镜' }, { status: 400 });
    }
    if (scenes.length > 15) {
      return NextResponse.json({ error: '分镜数量不能超过 15 个' }, { status: 400 });
    }

    const jobId = createStoryboardJob(
      apiKey.trim(),
      model || 'veo-2.0-generate-001',
      scenes,
      aspectRatio,
      keepOriginalLanguage
    );

    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `提交分镜任务失败: ${msg}` }, { status: 500 });
  }
}
