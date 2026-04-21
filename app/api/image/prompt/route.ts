import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI, generateImagePrompt, generateFullSetImagePrompts } from '@/lib/openai';
import { createGeminiClient, generateImagePromptGemini, generateFullSetImagePromptsGemini, generateImagePromptFromImagesGemini, generateFullSetImagePromptsFromImagesGemini } from '@/lib/gemini';
import { generateFullSetImagePromptsQwen, generateImagePromptQwen } from '@/lib/qwen';
import { createOpenRouter } from '@/lib/openrouter';
import { createDetaler } from '@/lib/detaler';
import { formatUpstreamError } from '@/lib/format-upstream-error';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, provider = 'gemini', model, productInfo, language = 'en', fullSet = false, baseImages } = body as {
      apiKey?: string;
      provider?: 'gemini' | 'openai' | 'qwen' | 'openrouter' | 'detaler';
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
        return NextResponse.json(
          { error: '根据垫图生成 Prompt 仅支持 Gemini，请先切换为 Gemini' },
          { status: 400 }
        );
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
      if (provider === 'qwen') {
        const result = await generateFullSetImagePromptsQwen(apiKey, model || 'qwen-plus', productInfo, lang);
        return NextResponse.json(result);
      }
      if (provider === 'openrouter') {
        const client = createOpenRouter(apiKey);
        const result = await generateFullSetImagePrompts(client, model || 'openai/gpt-4o-mini', productInfo, lang);
        return NextResponse.json(result);
      }
      if (provider === 'detaler') {
        const client = createDetaler(apiKey);
        const result = await generateFullSetImagePrompts(client, model || 'gpt-4o-mini', productInfo, lang);
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
    if (provider === 'qwen') {
      const prompt = await generateImagePromptQwen(apiKey, model || 'qwen-plus', productInfo, lang);
      return NextResponse.json({ prompt });
    }
    if (provider === 'openrouter') {
      const client = createOpenRouter(apiKey);
      const prompt = await generateImagePrompt(client, model || 'openai/gpt-4o-mini', productInfo, lang);
      return NextResponse.json({ prompt });
    }
    if (provider === 'detaler') {
      const client = createDetaler(apiKey);
      const prompt = await generateImagePrompt(client, model || 'gpt-4o-mini', productInfo, lang);
      return NextResponse.json({ prompt });
    }
    const openai = createOpenAI(apiKey);
    const prompt = await generateImagePrompt(openai, model || 'gpt-4o', productInfo, lang);
    return NextResponse.json({ prompt });
  } catch (e) {
    console.error('[api/image/prompt]', e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/Connection error|ENOTFOUND|ECONNREFUSED|fetch failed/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            'Detaler 连接失败：当前 API 地址不可达。请提供 Detaler 官方 API 文档中的 Base URL（OpenAI 兼容地址），我来替你改为正确地址。',
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: formatUpstreamError(e, 'Gemini 生图 Prompt') }, { status: 500 });
  }
}
