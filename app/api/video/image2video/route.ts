import { NextRequest, NextResponse } from 'next/server';
import { createImageToVideoTask, waitForTaskOutput } from '@/lib/runway';
import { generateVideoFromImage } from '@/lib/veo';

export const maxDuration = 320;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, model = 'runway', imageDataUrl, prompt } = body as {
      apiKey?: string;
      model?: string;
      imageDataUrl?: string;
      prompt?: string;
    };
    if (!apiKey?.trim()) {
      return NextResponse.json({ error: '请填写 API Key（Gemini 或 Runway）' }, { status: 400 });
    }
    if (!imageDataUrl?.startsWith('data:image/')) {
      return NextResponse.json({ error: '请上传一张有效图片' }, { status: 400 });
    }

    if (model?.startsWith('veo-')) {
      const videoUrl = await generateVideoFromImage(
        apiKey,
        model,
        prompt || 'Product shot, subtle motion, professional e-commerce style.',
        imageDataUrl
      );
      return NextResponse.json({ videoUrl, url: videoUrl });
    }

    const runwayModel = model === 'runway' ? 'gen3a_turbo' : 'gen3a_turbo';
    const { id } = await createImageToVideoTask(apiKey, {
      promptImage: imageDataUrl,
      promptText: prompt || 'Product shot, subtle motion, professional e-commerce style.',
      model: runwayModel,
      ratio: '1280:720',
      duration: 5,
    });
    const videoUrl = await waitForTaskOutput(apiKey, id, { intervalMs: 5000, timeoutMs: 120000 });
    return NextResponse.json({ videoUrl, url: videoUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : '图生视频失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
