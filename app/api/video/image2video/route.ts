import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createImageToVideoTask } from '@/lib/runway';
import { startVideoFromImage } from '@/lib/veo';
import { registerVeoJob, registerRunwayJob } from '@/lib/video-jobs';
import { formatUpstreamError } from '@/lib/format-upstream-error';

/** 首段仅提交任务，真正轮询在 GET /api/video/job/[id]，避免 Zeabur/反向代理长连接超时 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const _reqStart = Date.now();
  try {
    const body = await req.json();
    const { apiKey, model = 'runway', imageDataUrl, imageDataUrls, prompt, aspectRatio } = body as {
      apiKey?: string;
      model?: string;
      imageDataUrl?: string;
      imageDataUrls?: string[];
      prompt?: string;
      aspectRatio?: '16:9' | '9:16';
    };
    if (!apiKey?.trim()) {
      return NextResponse.json({ error: '请填写 API Key（Gemini 或 Runway）' }, { status: 400 });
    }
    const urlsRaw = Array.isArray(imageDataUrls) && imageDataUrls.length > 0 ? imageDataUrls : imageDataUrl ? [imageDataUrl] : [];
    const urls = urlsRaw.filter((u): u is string => typeof u === 'string' && u.startsWith('data:image/'));
    if (urls.length === 0) {
      return NextResponse.json({ error: '请至少上传一张有效图片' }, { status: 400 });
    }

    const jobId = randomUUID();

    if (model?.startsWith('veo-')) {
      const ar = aspectRatio === '9:16' || aspectRatio === '16:9' ? aspectRatio : undefined;
      const operation = await startVideoFromImage(
        apiKey,
        model,
        prompt || 'Product shot, subtle motion, professional e-commerce style.',
        urls.length === 1 ? urls[0] : urls.slice(0, 3),
        ar ? { aspectRatio: ar } : undefined
      );
      registerVeoJob(jobId, apiKey, operation);
      return NextResponse.json({ jobId, async: true });
    }

    const runwayModel = model === 'runway' ? 'gen3a_turbo' : 'gen3a_turbo';
    const multiNote =
      urls.length > 1
        ? ` User provided ${urls.length} product reference images (same product, different angles); keep the product faithful to the main image.`
        : '';
    const { id } = await createImageToVideoTask(apiKey, {
      promptImage: urls[0],
      promptText: (prompt || 'Product shot, subtle motion, professional e-commerce style.') + multiNote,
      model: runwayModel,
      ratio: '1280:720',
      duration: 5,
    });
    registerRunwayJob(jobId, apiKey, id);
    return NextResponse.json({ jobId, async: true });
  } catch (e) {
    console.error(`[api/video/image2video] 耗时 ${Date.now() - _reqStart}ms`, e);
    return NextResponse.json(
      { error: formatUpstreamError(e, '图生视频提交') },
      { status: 500 }
    );
  }
}
