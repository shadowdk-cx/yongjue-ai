import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const maxDuration = 60;

type SceneField = {
  index: number;
  description: string;
  cameraMove?: string;
  background?: string;
  lighting?: string;
  colorGrading?: string;
  composition?: string;
  textOverlay?: string | null;
  transition?: string;
  props?: string;
  audioMood?: string;
  subjectAction?: string;
  needsProductImage: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, productImageDataUrl, scenes, style } = body as {
      apiKey?: string;
      productImageDataUrl?: string;
      scenes?: SceneField[];
      style?: string;
    };

    if (!apiKey?.trim()) {
      return NextResponse.json({ error: '请填写 Gemini API Key' }, { status: 400 });
    }
    if (!productImageDataUrl) {
      return NextResponse.json({ error: '请先上传产品图' }, { status: 400 });
    }
    if (!scenes || scenes.length === 0) {
      return NextResponse.json({ error: '没有分镜数据' }, { status: 400 });
    }

    const imgMatch = productImageDataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!imgMatch) {
      return NextResponse.json({ error: '产品图格式无效' }, { status: 400 });
    }

    const scenesForAi = scenes.map((s) => ({
      index: s.index,
      description: s.description,
      subjectAction: s.subjectAction || undefined,
      textOverlay: s.textOverlay || undefined,
      props: s.props || undefined,
      needsProductImage: s.needsProductImage,
    }));

    const prompt = `你是一位专业电商视频导演。用户从参考视频提取了精确的分镜脚本，现在要用自己的新产品替换原视频中的旧产品。

## 第一步：识别新产品
仔细看用户上传的产品图片，精确识别：
- 产品类别和名称
- 颜色、材质、形状
- 关键视觉特征（logo、标签、独特设计元素等）

## 第二步：改写规则（极其重要！）
你只能修改与"产品"直接相关的内容，其他一切必须保持原样：

**必须替换的内容：**
- description 中旧产品的名称、颜色、材质、外观描述 → 替换为新产品
- subjectAction 中旧产品的动作描述 → 调整为新产品（保持相同的动作类型和速度）
- textOverlay 中旧产品品牌名/产品名 → 替换为新产品（保持相同的文字位置和样式描述）
- props 中与旧产品直接相关的描述 → 调整为新产品

**严禁修改的内容（必须逐字保留）：**
- 所有运镜描述（camera movement）
- 背景环境（background）
- 灯光设置（lighting）
- 色彩风格（colorGrading）
- 构图方式（composition）
- 转场方式（transition）
- 音乐氛围（audioMood）
- 场景的时间节奏和持续时长
- 不与产品相关的道具和环境元素

${style ? `视频整体风格：${style}` : ''}

当前分镜数据：
${JSON.stringify(scenesForAi, null, 2)}

## 输出格式
输出 ONLY valid JSON（无 markdown，无代码块标记，无解释文字）：
{
  "productName": "识别出的新产品名称和关键特征",
  "scenes": [
    {
      "index": 1,
      "description": "改写后的描述（仅产品部分变化）",
      "subjectAction": "改写后的主体动作（仅产品部分变化，如原来没有此字段就不要加）",
      "textOverlay": "改写后的文字叠加（仅产品名变化，如原来为null则保持null）",
      "props": "改写后的道具描述（仅产品相关部分变化，如原来没有则不加）"
    }
  ]
}

注意：只输出有变化的字段！如果某个字段不需要改动，就不要在输出中包含它。保持原有语言（中文用中文，英文用英文）。`;

    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: imgMatch[1], data: imgMatch[2] } },
            { text: prompt },
          ],
        },
      ],
    });

    const text = result.text?.trim() || '';
    const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed: {
      productName?: string;
      scenes?: Array<{
        index: number;
        description?: string;
        subjectAction?: string;
        textOverlay?: string | null;
        props?: string;
      }>;
    };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('[rewrite-scenes] Gemini 返回非 JSON:', text.slice(0, 500));
      return NextResponse.json({ error: '文案改写结果解析失败，请重试', raw: text.slice(0, 300) }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[rewrite-scenes] error:', msg);
    return NextResponse.json({ error: `文案改写失败: ${msg}` }, { status: 500 });
  }
}
