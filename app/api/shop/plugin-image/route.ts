import { NextRequest, NextResponse } from 'next/server';
import { createGeminiClient, generateImageGemini, buildImageRefinePrompt, buildEcomShopRemixPrompt } from '@/lib/gemini';

export const maxDuration = 300;

function corsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get('origin');
  const raw = process.env.ECOM_SHOP_PLUGIN_ORIGINS?.trim();
  if (!origin || !raw) return {};
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function unauthorized(cors: HeadersInit) {
  return NextResponse.json({ error: '未授权' }, { status: 401, headers: cors });
}

export async function OPTIONS(request: NextRequest) {
  const cors = corsHeaders(request);
  if (Object.keys(cors).length === 0) {
    return new NextResponse(null, { status: 204 });
  }
  return new NextResponse(null, { status: 204, headers: cors });
}

/**
 * 店铺页插件专用：使用服务端 GEMINI_API_KEY，Nano Banana 2 默认 gemini-3.1-flash-image-preview。
 * 鉴权：Authorization: Bearer <与 ECOM_SHOP_PLUGIN_SECRET 相同>
 * 跨域：设置 ECOM_SHOP_PLUGIN_ORIGINS=https://你的店铺域名（多个用英文逗号分隔）
 */
export async function POST(request: NextRequest) {
  const cors = corsHeaders(request);
  const secret = process.env.ECOM_SHOP_PLUGIN_SECRET?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (!secret || token !== secret) {
    return unauthorized(cors);
  }
  if (!geminiKey) {
    return NextResponse.json(
      { error: '服务器未配置 GEMINI_API_KEY' },
      { status: 500, headers: cors }
    );
  }

  try {
    const body = await request.json();
    const imageDataUrl = String(body.imageDataUrl || '').trim();
    const instruction = String(body.instruction || body.refineInstruction || '').trim();
    const mode = body.mode === 'refine' ? 'refine' : 'remix';
    const lang = body.language === 'en' ? 'en' : 'zh';
    const model =
      String(body.model || process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview').trim() ||
      'gemini-3.1-flash-image-preview';

    if (!imageDataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: '请提供 data:image/... 格式的图片' }, { status: 400, headers: cors });
    }
    if (!instruction) {
      return NextResponse.json({ error: '请填写改版或精修说明' }, { status: 400, headers: cors });
    }

    const prompt =
      mode === 'refine' ? buildImageRefinePrompt(instruction, lang) : buildEcomShopRemixPrompt(instruction, lang);
    if (!prompt) {
      return NextResponse.json({ error: '说明无效' }, { status: 400, headers: cors });
    }

    const ai = createGeminiClient(geminiKey);
    const dataUrl = await generateImageGemini(ai, model, prompt, imageDataUrl);
    return NextResponse.json({ url: dataUrl, model }, { headers: cors });
  } catch (e) {
    const message = e instanceof Error ? e.message : '生图失败';
    return NextResponse.json({ error: message }, { status: 500, headers: cors });
  }
}
