import { NextRequest, NextResponse } from 'next/server';
import { createGeminiClient, generateImageGemini } from '@/lib/gemini';

export const maxDuration = 120;

/**
 * 诊断接口：用一个极简提示词测试 Gemini 生图的真实耗时。
 * GET /api/health/test-gen?key=你的GeminiKey&model=gemini-2.5-flash-image
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  const model = req.nextUrl.searchParams.get('model') || 'gemini-2.5-flash-image';
  if (!key) {
    return NextResponse.json({ error: '请提供 ?key=你的GeminiKey' }, { status: 400 });
  }

  const steps: { step: string; ms: number }[] = [];
  const t0 = Date.now();

  try {
    steps.push({ step: '开始创建客户端', ms: 0 });
    const ai = createGeminiClient(key);
    steps.push({ step: '客户端创建完成', ms: Date.now() - t0 });

    const t1 = Date.now();
    steps.push({ step: '开始调用 Gemini 生图', ms: Date.now() - t0 });
    const dataUrl = await generateImageGemini(ai, model, 'A single red apple on a white background, studio lighting, product photo');
    const genMs = Date.now() - t1;
    steps.push({ step: 'Gemini 生图完成', ms: Date.now() - t0 });

    const sizeKB = Math.round(dataUrl.length / 1024);
    steps.push({ step: `图片大小 ${sizeKB} KB`, ms: Date.now() - t0 });

    return NextResponse.json({
      ok: true,
      model,
      totalMs: Date.now() - t0,
      geminiMs: genMs,
      imageSizeKB: sizeKB,
      steps,
    });
  } catch (e) {
    steps.push({ step: `出错: ${e instanceof Error ? e.message : String(e)}`, ms: Date.now() - t0 });
    return NextResponse.json({
      ok: false,
      model,
      totalMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
      steps,
    }, { status: 500 });
  }
}
