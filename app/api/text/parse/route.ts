import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI, parseProduct } from '@/lib/openai';
import { createGeminiClient, parseProductGemini } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, provider = 'gemini', model, productInfo } = body as {
      apiKey?: string;
      provider?: 'gemini' | 'openai';
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
    const openai = createOpenAI(apiKey);
    const fields = await parseProduct(openai, model || 'gpt-4o', productInfo);
    return NextResponse.json({ fields });
  } catch (e) {
    const message = e instanceof Error ? e.message : '解析失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
