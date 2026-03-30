import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI } from '@/lib/openai';
import { createGeminiClient, generateImageGemini, buildImageRefinePrompt } from '@/lib/gemini';
import { formatUpstreamError } from '@/lib/format-upstream-error';

export const maxDuration = 300;

const SIZE_MAP: Record<string, '1024x1024' | '1792x1024' | '1024x1792'> = {
  '1024x1024': '1024x1024',
  '1792x1024': '1792x1024',
  '1024x1792': '1024x1792',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      apiKey,
      provider = 'gemini',
      model,
      prompt,
      size = '1024x1024',
      baseImage,
      baseImages,
      mode,
      refineInstruction,
      promptLanguage = 'zh',
    } = body as {
      apiKey?: string;
      provider?: 'gemini' | 'openai';
      model?: string;
      prompt?: string;
      size?: string;
      baseImage?: string;
      baseImages?: string[];
      mode?: string;
      refineInstruction?: string;
      promptLanguage?: 'en' | 'zh';
    };
    if (!apiKey?.trim()) {
      return NextResponse.json({ error: '缺少 apiKey' }, { status: 400 });
    }
    const refImages = Array.isArray(baseImages) && baseImages.length > 0 ? baseImages : baseImage ? [baseImage] : undefined;

    if (mode === 'refine') {
      if (provider !== 'gemini') {
        return NextResponse.json({ error: '图片精修仅支持 Gemini 生图（请在工具里切换服务商）' }, { status: 400 });
      }
      const instr = String(refineInstruction || '').trim();
      if (!instr) {
        return NextResponse.json({ error: '请填写精修说明' }, { status: 400 });
      }
      const src = refImages?.[0];
      if (!src || !src.startsWith('data:image/')) {
        return NextResponse.json({ error: '精修需要一张原图，请先选择要精修的图片' }, { status: 400 });
      }
      const lang = promptLanguage === 'en' ? 'en' : 'zh';
      const composed = buildImageRefinePrompt(instr, lang);
      const ai = createGeminiClient(apiKey);
      const imageModel = model || 'gemini-2.5-flash-image';
      const dataUrl = await generateImageGemini(ai, imageModel, composed, src);
      return NextResponse.json({ url: dataUrl });
    }

    if (!prompt?.trim()) {
      return NextResponse.json({ error: '缺少 prompt' }, { status: 400 });
    }
    if (provider === 'gemini') {
      const ai = createGeminiClient(apiKey);
      const imageModel = model || 'gemini-2.5-flash-image';
      const dataUrl = await generateImageGemini(ai, imageModel, prompt.trim(), refImages);
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
    console.error('[api/image/generate]', e);
    return NextResponse.json({ error: formatUpstreamError(e, 'Gemini 生图') }, { status: 500 });
  }
}
