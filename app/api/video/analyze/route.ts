import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { extractFramesFromDataUrl } from '@/lib/extract-frames';

export const maxDuration = 120;

function buildAnalyzePrompt(language: string) {
  const langRule = language === 'zh'
    ? '- All text fields MUST be written in Chinese (中文)'
    : language === 'auto'
      ? '- Write all text fields in the SAME language as the video (if the video has Chinese text/voiceover, use Chinese; if English, use English)'
      : '- All text fields MUST be written in English';

  return `You are a world-class video director who needs to create an EXACT shot-by-shot recreation plan of this e-commerce product video — so precise that someone could reproduce it frame-for-frame with only a different product.

Watch the video VERY carefully, multiple times if needed. For EACH distinct shot/scene, extract ALL of the following details:

**Scene-level details (mandatory for every scene):**
1. "description" — A rich, cinematic description of EXACTLY what happens. Include subject, action, position in frame, movement speed, and timing.
2. "cameraMove" — Precise camera movement: e.g. "slow zoom in from medium shot to close-up", "static locked-off tripod shot", "smooth dolly right to left", "360° orbital pan around product", "tilt up from product base to top". Include speed (slow/medium/fast) and exact direction.
3. "background" — Exact background description: color, texture, material (e.g. "pure white seamless paper backdrop", "dark gray concrete surface with subtle texture", "blurred kitchen environment with warm tones", "gradient from soft pink to white").
4. "lighting" — Precise lighting setup: direction, quality, color temperature (e.g. "soft diffused key light from upper-left, subtle rim light from behind, warm 3200K", "bright even studio lighting, no harsh shadows, cool daylight 5600K", "dramatic side lighting with deep shadows on right").
5. "colorGrading" — Color palette and mood: overall tone, saturation, contrast (e.g. "warm golden tones, slightly desaturated, high contrast", "cool minimalist palette, low saturation, soft contrast", "vibrant saturated colors, punchy contrast").
6. "composition" — Framing and layout: subject position, angle, distance (e.g. "product centered in frame, slight 3/4 angle, fills 60% of frame", "extreme close-up of product texture, shallow depth of field", "wide shot with product small in lower-third, lots of negative space above").
7. "textOverlay" — ANY text shown on screen. Include EXACT text content, position (top/center/bottom, left/center/right), approximate font style (serif/sans-serif, bold/thin), size (small/medium/large), color, and any animation (fade in, slide up, typewriter, etc.). Use null if no text.
8. "transition" — How this scene begins and ends: "hard cut", "fade from black", "cross dissolve", "slide left", "zoom transition", etc. Describe BOTH the in-transition and out-transition.
9. "props" — All non-product items visible: surface/table material, decorative elements, hands/model details, packaging, accessories (e.g. "marble surface, small green plant in corner, scattered coffee beans", "model's hand with natural nails holding product at 45°").
10. "audioMood" — Background music/sound mood for this segment (e.g. "upbeat electronic with soft percussion", "calm ambient piano", "no music, subtle product handling ASMR sounds").
11. "subjectAction" — What the main subject (product/model) is DOING in this scene (e.g. "product rotates 180° clockwise on turntable", "hand picks up product from surface and raises to camera", "liquid pours from bottle in slow motion").

Also detect the primary language from text overlays/voiceover and include it as "detectedLanguage".

Output ONLY valid JSON (no markdown, no explanation):
{
  "scenes": [
    {
      "index": 1,
      "startSec": 0,
      "endSec": 5,
      "durationSec": 5,
      "description": "产品在白色大理石转盘上以匀速缓慢顺时针旋转一整圈，展示产品正面和侧面细节",
      "cameraMove": "static locked tripod shot, eye level, no movement",
      "background": "纯白无缝背景纸，干净简约",
      "lighting": "柔和的漫射主光从左上方照射，轻微的轮廓光从右后方勾勒产品边缘，色温5600K日光",
      "colorGrading": "明亮干净的色调，低对比度，轻微提亮阴影，自然饱和度",
      "composition": "产品居中，3/4角度，占画面约50%，上方留白约20%",
      "textOverlay": null,
      "transition": "从黑色渐入(fade from black) | 硬切到下一场景(hard cut)",
      "props": "白色大理石圆形转盘",
      "audioMood": "轻快的电子背景音乐，节奏舒缓",
      "subjectAction": "产品在转盘上顺时针匀速旋转360度",
      "needsProductImage": true
    }
  ],
  "totalDurationSec": 48,
  "style": "整体视觉风格的详细描述（配色、氛围、调性）",
  "summary": "视频整体结构和叙事流程描述",
  "detectedLanguage": "zh"
}

CRITICAL Rules:
- Each scene should be 4-8 seconds (matching AI video generation clip length)
- Be EXTREMELY specific and detailed — vague descriptions produce bad results
- Every visual detail matters: exact colors, exact positions, exact movements, exact timing
${langRule}
- If text overlays exist, include the EXACT original text, position, style, and animation
- Include ALL scenes: intro, product shots, lifestyle shots, text cards, transitions, outro
- "needsProductImage" = true ONLY for scenes where the product is visually prominent
- Camera movements must specify speed AND direction precisely
- Describe compositions using actual framing terminology (close-up, medium shot, wide shot, etc.)`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, videoDataUrl, language } = body as {
      apiKey?: string;
      videoDataUrl?: string;
      language?: string;
    };

    if (!apiKey?.trim()) {
      return NextResponse.json({ error: '请填写 Gemini API Key' }, { status: 400 });
    }
    if (!videoDataUrl) {
      return NextResponse.json({ error: '请上传参考视频' }, { status: 400 });
    }

    const match = videoDataUrl.match(/^data:(video\/[a-z0-9]+);base64,(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: '视频格式无效，请上传 MP4 文件' }, { status: 400 });
    }
    const mimeType = match[1];
    const base64Data = match[2];

    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: buildAnalyzePrompt(language || 'auto') },
          ],
        },
      ],
    });

    const text = result.text?.trim() || '';
    const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

    let storyboard: Record<string, unknown>;
    try {
      storyboard = JSON.parse(jsonStr);
    } catch {
      console.error('[video/analyze] Gemini 返回非 JSON:', text.slice(0, 500));
      return NextResponse.json(
        { error: '视频分析结果解析失败，请重试', raw: text.slice(0, 300) },
        { status: 500 }
      );
    }

    if (!(storyboard as Record<string, unknown>).detectedLanguage) {
      (storyboard as Record<string, string>).detectedLanguage = language === 'zh' ? 'zh' : language === 'en' ? 'en' : 'auto';
    }

    // 提取每个场景的关键帧
    const scenes = (storyboard as { scenes?: Array<{ startSec?: number; frameDataUrl?: string }> }).scenes;
    if (scenes && scenes.length > 0) {
      try {
        const timestamps = scenes.map((s) => Math.max(0, (s.startSec ?? 0) + 0.5));
        const frames = extractFramesFromDataUrl(videoDataUrl, timestamps);
        for (let i = 0; i < scenes.length; i++) {
          if (frames[i]) scenes[i].frameDataUrl = frames[i];
        }
        console.log(`[video/analyze] extracted ${frames.filter(Boolean).length}/${scenes.length} scene frames`);
      } catch (e) {
        console.warn('[video/analyze] frame extraction failed (non-fatal):', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json(storyboard);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[video/analyze] error:', msg);
    return NextResponse.json({ error: `视频分析失败: ${msg}` }, { status: 500 });
  }
}
