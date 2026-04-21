import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const maxDuration = 60;

/**
 * 接收原始场景帧 + 新产品图片，用 Gemini 在帧中替换产品。
 * 返回编辑后的帧 data URL。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, frameDataUrl, productImageDataUrl, sceneDescription } = body as {
      apiKey?: string;
      frameDataUrl?: string;
      productImageDataUrl?: string;
      sceneDescription?: string;
    };

    if (!apiKey?.trim()) {
      return NextResponse.json({ error: '请填写 Gemini API Key' }, { status: 400 });
    }
    if (!frameDataUrl || !productImageDataUrl) {
      return NextResponse.json({ error: '缺少原始帧或产品图片' }, { status: 400 });
    }

    const frameMatch = frameDataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    const productMatch = productImageDataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!frameMatch || !productMatch) {
      return NextResponse.json({ error: '图片格式无效' }, { status: 400 });
    }

    const prompt = `You are a professional product photo editor. I'm giving you two images:

IMAGE 1 (first image): An original video frame from a product advertisement
IMAGE 2 (second image): A new product photo that should replace the product in Image 1

Your task: Generate a NEW image that is EXACTLY like Image 1, but with the original product replaced by the product from Image 2.

CRITICAL RULES:
- Keep the EXACT same background, lighting, shadows, reflections, and environment from Image 1
- Keep the EXACT same camera angle and perspective from Image 1
- Keep the EXACT same color grading and mood from Image 1
- Keep any hands/model poses EXACTLY the same — only change what they're holding/touching
- The new product must fit naturally into the scene — match the size, perspective, and lighting of the original product
- Preserve ALL text overlays, logos, and graphics from Image 1 exactly as they are
- The result should look like a real photograph, not AI-generated
${sceneDescription ? `\nScene context: ${sceneDescription}` : ''}

Output a single photorealistic image.`;

    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: frameMatch[1], data: frameMatch[2] } },
            { inlineData: { mimeType: productMatch[1], data: productMatch[2] } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseModalities: ['image', 'text'],
      },
    });

    const parts = result.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType || 'image/png';
          return NextResponse.json({
            editedFrameDataUrl: `data:${mime};base64,${part.inlineData.data}`,
          });
        }
      }
    }

    return NextResponse.json(
      { error: 'Gemini 未返回编辑后的图片，请重试' },
      { status: 500 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[replace-product] error:', msg);
    return NextResponse.json({ error: `产品替换失败: ${msg}` }, { status: 500 });
  }
}
