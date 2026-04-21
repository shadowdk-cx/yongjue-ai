import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI, generateCopy } from '@/lib/openai';
import { createGeminiClient, generateCopyGemini } from '@/lib/gemini';
import { generateCopyQwen } from '@/lib/qwen';
import { createOpenRouter } from '@/lib/openrouter';
import { createDetaler } from '@/lib/detaler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      apiKey,
      provider = 'gemini',
      model,
      platform = 'amazon',
      language = 'en',
      productInfo,
      prompts = {},
    } = body as {
      apiKey?: string;
      provider?: 'gemini' | 'openai' | 'qwen' | 'openrouter' | 'detaler';
      model?: string;
      platform?: string;
      language?: string;
      productInfo?: string;
      prompts?: { title?: string; bullets?: string; description?: string };
    };
    if (!apiKey || !productInfo) {
      return NextResponse.json({ error: '缺少 apiKey 或 productInfo' }, { status: 400 });
    }
    const promptOpts = {
      title: prompts.title || 'Generate an SEO-friendly product title.',
      bullets: prompts.bullets || 'Generate 3-5 bullet points.',
      description: prompts.description || 'Generate a product description.',
    };
    if (provider === 'gemini') {
      const ai = createGeminiClient(apiKey);
      const result = await generateCopyGemini(ai, model || 'gemini-2.0-flash', productInfo, platform, language, promptOpts);
      return NextResponse.json(result);
    }
    if (provider === 'qwen') {
      const result = await generateCopyQwen(apiKey, model || 'qwen-plus', productInfo, platform, language, promptOpts);
      return NextResponse.json(result);
    }
    if (provider === 'openrouter') {
      const client = createOpenRouter(apiKey);
      const result = await generateCopy(client, model || 'openai/gpt-4o-mini', productInfo, platform, language, promptOpts);
      return NextResponse.json(result);
    }
    if (provider === 'detaler') {
      const client = createDetaler(apiKey);
      const result = await generateCopy(client, model || 'gpt-4o-mini', productInfo, platform, language, promptOpts);
      return NextResponse.json(result);
    }
    const openai = createOpenAI(apiKey);
    const result = await generateCopy(openai, model || 'gpt-4o', productInfo, platform, language, promptOpts);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : '生成失败';
    if (/Connection error|ENOTFOUND|ECONNREFUSED|fetch failed/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'Detaler 连接失败：当前 API 地址不可达。请提供 Detaler 官方 API 文档中的 Base URL（OpenAI 兼容地址），我来替你改为正确地址。',
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
