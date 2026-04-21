import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI, parseProduct } from '@/lib/openai';
import { createGeminiClient, parseProductGemini } from '@/lib/gemini';
import { parseProductQwen } from '@/lib/qwen';
import { createOpenRouter } from '@/lib/openrouter';
import { createDetaler } from '@/lib/detaler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, provider = 'gemini', model, productInfo } = body as {
      apiKey?: string;
      provider?: 'gemini' | 'openai' | 'qwen' | 'openrouter' | 'detaler';
      model?: string;
      productInfo?: string;
    };
    if (!apiKey || !productInfo) {
      return NextResponse.json({ error: '缺少 apiKey 或 productInfo' }, { status: 400 });
    }
    if (provider === 'gemini') {
      const ai = createGeminiClient(apiKey);
      const fields = await parseProductGemini(ai, model || 'gemini-2.0-flash', productInfo);
      return NextResponse.json({ fields });
    }
    if (provider === 'qwen') {
      const fields = await parseProductQwen(apiKey, model || 'qwen-plus', productInfo);
      return NextResponse.json({ fields });
    }
    if (provider === 'openrouter') {
      const client = createOpenRouter(apiKey);
      const fields = await parseProduct(client, model || 'openai/gpt-4o-mini', productInfo);
      return NextResponse.json({ fields });
    }
    if (provider === 'detaler') {
      const client = createDetaler(apiKey);
      const fields = await parseProduct(client, model || 'gpt-4o-mini', productInfo);
      return NextResponse.json({ fields });
    }
    const openai = createOpenAI(apiKey);
    const fields = await parseProduct(openai, model || 'gpt-4o', productInfo);
    return NextResponse.json({ fields });
  } catch (e) {
    const message = e instanceof Error ? e.message : '解析失败';
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
