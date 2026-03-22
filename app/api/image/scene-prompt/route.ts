import { NextRequest, NextResponse } from 'next/server';
import { createGeminiClient, extractScenePromptFromImageGemini } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, model, imageDataUrl, language = 'zh' } = body as {
      apiKey?: string;
      model?: string;
      imageDataUrl?: string;
      language?: 'en' | 'zh';
    };

    if (!apiKey) return NextResponse.json({ error: '缺少 apiKey' }, { status: 400 });
    if (!imageDataUrl) return NextResponse.json({ error: '缺少 imageDataUrl' }, { status: 400 });

    const ai = createGeminiClient(apiKey);
    const prompt = await extractScenePromptFromImageGemini(ai, model || 'gemini-2.0-flash', imageDataUrl, language === 'en' ? 'en' : 'zh');
    return NextResponse.json({ prompt });
  } catch (e) {
    const message = e instanceof Error ? e.message : '提取失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

