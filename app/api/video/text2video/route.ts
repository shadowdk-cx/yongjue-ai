import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createTextToVideoTask } from '@/lib/runway';
import { startVideoFromText } from '@/lib/veo';
import { registerVeoJob, registerRunwayJob } from '@/lib/video-jobs';
import { formatUpstreamError } from '@/lib/format-upstream-error';
import { translatePromptToEnglish } from '@/lib/translate-prompt';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const _reqStart = Date.now();
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

    const jobId = randomUUID();

    if (model?.startsWith('veo-')) {
      const ar = aspectRatio === '9:16' || aspectRatio === '16:9' ? aspectRatio : undefined;
      const enPrompt = await translatePromptToEnglish(apiKey, prompt);
      const config = ar ? { aspectRatio: ar as '16:9' | '9:16' } : undefined;
      const operation = await startVideoFromText(apiKey, model, enPrompt, config);
      registerVeoJob(jobId, apiKey, operation, model, {
        type: 'text', prompt: enPrompt, config,
      });
      return NextResponse.json({ jobId, async: true });
    }

    const runwayModel = model === 'runway' ? 'gen3a_turbo' : 'gen3a_turbo';
    const { id } = await createTextToVideoTask(apiKey, {
      promptText: prompt.trim().slice(0, 1000),
      model: runwayModel,
      ratio: '1280:720',
      duration: 5,
    });
    registerRunwayJob(jobId, apiKey, id);
    return NextResponse.json({ jobId, async: true });
  } catch (e) {
    console.error(`[api/video/text2video] 耗时 ${Date.now() - _reqStart}ms`, e);
    return NextResponse.json(
      { error: formatUpstreamError(e, '文生视频提交') },
      { status: 500 }
    );
  }
}
