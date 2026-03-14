import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI } from '@/lib/openai';
import { createGeminiClient, generateImageGemini } from '@/lib/gemini';

const SIZE_MAP: Record<string, '1024x1024' | '1792x1024' | '1024x1792'> = {
  '1024x1024': '1024x1024',
  '1792x1024': '1792x1024',
  '1024x1792': '1024x1792',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, provider = 'gemini', model, prompt, size = '1024x1024', baseImage, baseImages } = body as {
      apiKey?: string;
      provider?: 'gemini' | 'openai';
      model?: string;
      prompt?: string;
      size?: string;
      baseImage?: string;
      baseImages?: string[];
    };
    if (!apiKey || !prompt) {
      return NextResponse.json({ error: '缺少 apiKey 或 prompt' }, { status: 400 });
    }
    const refImages = Array.isArray(baseImages) && baseImages.length > 0 ? baseImages : baseImage ? [baseImage] : undefined;
    if (provider === 'gemini') {
      const ai = createGeminiClient(apiKey);
      const imageModel = model || 'gemini-2.5-flash-image';
      const dataUrl = await generateImageGemini(ai, imageModel, prompt, refImages);
      return NextResponse.json({ url: dataUrl });
    }
    const openai = createOpenAI(apiKey);
    const sizeOption = SIZE_MAP[size] || '1024x1024';
    if (model?.startsWith('dall-e')) {
      const imageModel = model === 'dall-e-2' ? 'dall-e-2' : 'dall-e-3';
      const res = await openai.images.generate({
        model: imageModel,
        prompt,
        n: 1,
        size: imageModel === 'dall-e-3' ? sizeOption : '1024x1024',
        response_format: 'url',
        quality: 'standard',
      });
      const data = res.data?.[0];
      const url = data?.url;
      if (!url) return NextResponse.json({ error: '未返回图片' }, { status: 500 });
      return NextResponse.json({ url, data: res.data });
    }
    return NextResponse.json({ error: '当前仅支持 DALL-E 或 Gemini，请选择提供商' }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : '生图失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
