import { NextRequest, NextResponse } from 'next/server';
import { createTextToVideoTask, waitForTaskOutput } from '@/lib/runway';
import { generateVideoFromText } from '@/lib/veo';
import { persistMp4DataUrlToPublic } from '@/lib/persist-video';

export const maxDuration = 320;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, model = 'runway', prompt, aspectRatio } = body as {
      apiKey?: string;
      model?: string;
      prompt?: string;
      aspectRatio?: '16:9' | '9:16';
    };
    if (!apiKey?.trim()) {
      return NextResponse.json({ error: '请填写 API Key（Gemini 或 Runway）' }, { status: 400 });
    }
    if (!prompt?.trim()) {
      return NextResponse.json({ error: '请填写视频描述/脚本' }, { status: 400 });
    }

    if (model?.startsWith('veo-')) {
      const ar = aspectRatio === '9:16' || aspectRatio === '16:9' ? aspectRatio : undefined;
      const dataUrl = await generateVideoFromText(apiKey, model, prompt, ar ? { aspectRatio: ar } : undefined);
      const videoUrl = persistMp4DataUrlToPublic(dataUrl);
      return NextResponse.json({ videoUrl, url: videoUrl });
    }

    const runwayModel = model === 'runway' ? 'gen3a_turbo' : 'gen3a_turbo';
    const { id } = await createTextToVideoTask(apiKey, {
      promptText: prompt.trim().slice(0, 1000),
      model: runwayModel,
      ratio: '1280:720',
      duration: 5,
    });
    const videoUrl = await waitForTaskOutput(apiKey, id, { intervalMs: 5000, timeoutMs: 300000 });
    return NextResponse.json({ videoUrl, url: videoUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : '文生视频失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
