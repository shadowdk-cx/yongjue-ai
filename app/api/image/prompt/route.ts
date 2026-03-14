import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI, generateImagePrompt, generateFullSetImagePrompts } from '@/lib/openai';
import { createGeminiClient, generateImagePromptGemini, generateFullSetImagePromptsGemini, generateImagePromptFromImagesGemini, generateFullSetImagePromptsFromImagesGemini } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, provider = 'gemini', model, productInfo, language = 'en', fullSet = false, baseImages } = body as {
      apiKey?: string;
      provider?: 'gemini' | 'openai';
      model?: string;
      productInfo?: string;
      language?: 'en' | 'zh';
      fullSet?: boolean;
      baseImages?: string[];
    };
    if (!apiKey) {
      return NextResponse.json({ error: '缺少 apiKey' }, { status: 400 });
    }
    const lang = language === 'zh' ? 'zh' : 'en';
    const fromImages = Array.isArray(baseImages) && baseImages.length > 0;

    if (fromImages) {
      if (provider !== 'gemini') {
        return NextResponse.json({ error: '根据垫图生成 Prompt 仅支持 Gemini，请先切换为 Gemini' }, { status: 400 });
      }
      const ai = createGeminiClient(apiKey);
      if (fullSet) {
        const result = await generateFullSetImagePromptsFromImagesGemini(ai, model || 'gemini-2.0-flash', baseImages, lang);
        return NextResponse.json(result);
      }
      const prompt = await generateImagePromptFromImagesGemini(ai, model || 'gemini-2.0-flash', baseImages, lang);
      return NextResponse.json({ prompt });
    }

    if (!productInfo) {
      return NextResponse.json({ error: '缺少 productInfo，或上传垫图后使用「根据垫图生成」' }, { status: 400 });
    }

    if (fullSet) {
      if (provider === 'gemini') {
        const ai = createGeminiClient(apiKey);
        const result = await generateFullSetImagePromptsGemini(ai, model || 'gemini-2.0-flash', productInfo, lang);
        return NextResponse.json(result);
      }
      const openai = createOpenAI(apiKey);
      const result = await generateFullSetImagePrompts(openai, model || 'gpt-4o', productInfo, lang);
      return NextResponse.json(result);
    }

    if (provider === 'gemini') {
      const ai = createGeminiClient(apiKey);
      const prompt = await generateImagePromptGemini(ai, model || 'gemini-2.0-flash', productInfo, lang);
      return NextResponse.json({ prompt });
    }
    const openai = createOpenAI(apiKey);
    const prompt = await generateImagePrompt(openai, model || 'gpt-4o', productInfo, lang);
    return NextResponse.json({ prompt });
  } catch (e) {
    const message = e instanceof Error ? e.message : '生成失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
