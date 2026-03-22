import { NextRequest, NextResponse } from 'next/server';
import { createImageToVideoTask, waitForTaskOutput } from '@/lib/runway';
import { generateVideoFromImage } from '@/lib/veo';
import { persistMp4DataUrlToPublic } from '@/lib/persist-video';

export const maxDuration = 320;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, model = 'runway', imageDataUrl, imageDataUrls, prompt, aspectRatio } = body as {
      apiKey?: string;
      model?: string;
      imageDataUrl?: string;
      /** 多张产品垫图（data URL），Veo 3.1 最多使用 3 张 */
      imageDataUrls?: string[];
      prompt?: string;
      /** Veo 专用：竖屏电商常用 9:16 */
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

    if (model?.startsWith('veo-')) {
      const ar = aspectRatio === '9:16' || aspectRatio === '16:9' ? aspectRatio : undefined;
      const dataUrl = await generateVideoFromImage(
        apiKey,
        model,
        prompt || 'Product shot, subtle motion, professional e-commerce style.',
        urls.length === 1 ? urls[0] : urls.slice(0, 3),
        ar ? { aspectRatio: ar } : undefined
      );
      /** 落盘为静态文件，避免把整段 base64 MP4 塞进 JSON（浏览器 parse 会卡死、界面一直「生成中」） */
      const videoUrl = persistMp4DataUrlToPublic(dataUrl);
      return NextResponse.json({ videoUrl, url: videoUrl });
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
    const videoUrl = await waitForTaskOutput(apiKey, id, { intervalMs: 5000, timeoutMs: 300000 });
    return NextResponse.json({ videoUrl, url: videoUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : '图生视频失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
