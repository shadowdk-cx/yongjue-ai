import { GoogleGenAI } from '@google/genai';

const PARSE_SYSTEM = `你是一个电商产品分析助手。请根据用户提供的产品信息，提取并输出以下结构化字段（每项用简短清晰的文本，若无法推断可留空）：
- productTitle: 产品标题/名称
- functionalSellingPoints: 功能卖点
- coreFeaturesAndParams: 核心功能与技术参数
- targetAudience: 主要用户群体
- useScenarios: 典型使用场景
- technicalSellingPoints: 核心技术卖点
- verifiedPurchaseReasons: 已验证购买理由
- painPoints: 明确痛点问题
- materialCraft: 材质工艺
- competitorAdvantage: 竞品对比优势

请以 JSON 对象形式返回，键为上述英文，值为字符串。只返回 JSON，不要其他说明。`;

export function createGeminiClient(apiKey: string) {
  if (!apiKey?.trim()) throw new Error('API Key 未配置');
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

export async function parseProductGemini(
  ai: GoogleGenAI,
  model: string,
  productInfo: string
): Promise<Record<string, string>> {
  const response = await ai.models.generateContent({
    model: model || 'gemini-2.0-flash',
    contents: `${PARSE_SYSTEM}\n\n产品信息：\n${productInfo}`,
  });
  const content = (response.text ?? '').trim() || '{}';
  try {
    const parsed = JSON.parse(content.replace(/^```json?\s*|\s*```$/g, ''));
    return typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function generateCopyGemini(
  ai: GoogleGenAI,
  model: string,
  productInfo: string,
  platform: string,
  language: string,
  prompts: { title: string; bullets: string; description: string }
): Promise<{ title: string; bullets: string; description: string }> {
  const isZh = language === 'zh' || language === 'zh-CN';
  const langInstruction = isZh
    ? '【重要】全文必须使用中文（简体）生成，标题、卖点、详情描述均用中文表述，不要使用英文。'
    : '请使用英文生成。';
  const platformNote = isZh
    ? platform === 'amazon' ? '（亚马逊中文站风格：标题 80–200 字符，5 条卖点，内容用中文）' : platform === 'douyin' ? '（抖音/国内电商风格，全部中文）' : '（独立站中文，全部中文）'
    : platform === 'amazon' ? '（亚马逊风格：标题 80–200 字符，5 条 Bullet Points）' : '（独立站风格）';
  const userContent = `${langInstruction} ${platformNote}\n\n产品信息：\n${productInfo}\n\n请按以下三个部分分别生成，只输出这三部分内容，用明确分隔符分开（例如 ---标题---、---卖点---、---详情---）：\n1. 标题生成要求：${prompts.title}\n2. 卖点生成要求：${prompts.bullets}\n3. 描述生成要求：${prompts.description}`;

  const response = await ai.models.generateContent({
    model: model || 'gemini-2.0-flash',
    contents: userContent,
  });
  const raw = (response.text ?? '').trim();

  const titleMatch = raw.match(/-{2,}\s*标题?\s*-{2,}\s*([\s\S]*?)(?=-{2,}|$)/i) || raw.match(/标题[：:]\s*([^\n]+)/);
  const bulletsMatch = raw.match(/-{2,}\s*卖点?\s*-{2,}\s*([\s\S]*?)(?=-{2,}|$)/i) || raw.match(/卖点[：:]\s*([\s\S]*?)(?=详情|描述|-{2,}|$)/i);
  const descMatch = raw.match(/-{2,}\s*详情?\s*-{2,}\s*([\s\S]*?)(?=$)/i) || raw.match(/详情[：:]\s*([\s\S]*)/i);

  return {
    title: (titleMatch?.[1] || raw.split('\n')[0] || '').trim(),
    bullets: (bulletsMatch?.[1] || '').trim(),
    description: (descMatch?.[1] || '').trim(),
  };
}

export async function generateImagePromptGemini(
  ai: GoogleGenAI,
  model: string,
  productInfo: string,
  language: 'en' | 'zh' = 'en'
): Promise<string> {
  const isZh = language === 'zh';
  const systemEn = 'You are an expert at writing image generation prompts for e-commerce product photos. Output a single, detailed English prompt for a high-quality product image: white or minimal background, professional lighting, clear product focus. No code or extra text, only the prompt.';
  const systemZh = '你是电商产品图生图提示词专家。请根据产品信息，输出一条详细的中文生图提示词：白底或简约背景、专业光影、产品主体清晰。不要代码或多余说明，只输出这一条提示词。';
  const userEn = `Product information:\n${productInfo}\n\nWrite one detailed image generation prompt in English.`;
  const userZh = `产品信息：\n${productInfo}\n\n请用中文写一条详细的生图提示词。`;
  const contents = isZh ? `${systemZh}\n\n${userZh}` : `${systemEn}\n\n${userEn}`;
  const response = await ai.models.generateContent({
    model: model || 'gemini-2.0-flash',
    contents,
  });
  return (response.text ?? '').trim();
}

/** 根据产品主图（垫图）生成一条生图提示词，支持多图参考。仅文本模型。 */
export async function generateImagePromptFromImagesGemini(
  ai: GoogleGenAI,
  model: string,
  baseImages: string[],
  language: 'en' | 'zh' = 'en'
): Promise<string> {
  const validImages = baseImages.filter((u): u is string => typeof u === 'string' && u.startsWith('data:')).map(parseDataUrl).filter(Boolean) as { mimeType: string; data: string }[];
  if (validImages.length === 0) throw new Error('请至少提供一张垫图');
  const isZh = language === 'zh';
  const textEn = 'The image(s) above are product reference photo(s). Write ONE detailed image generation prompt in English for a high-quality e-commerce product image: white or minimal background, professional lighting, clear product focus. Describe the product and style based on what you see. Output only the prompt, no other text.';
  const textZh = '以上是产品参考图。请根据图中产品与风格，用简体中文写一条详细的电商生图提示词：白底或简约背景、专业光影、产品主体清晰。只输出这一条提示词，不要其他说明。';
  const textPart = isZh ? textZh : textEn;
  const contents = [
    { role: 'user' as const, parts: [{ text: textPart }, ...validImages.map((img) => ({ inlineData: img }))] },
  ];
  const response = await ai.models.generateContent({
    model: model || 'gemini-2.0-flash',
    contents,
  } as Parameters<GoogleGenAI['models']['generateContent']>[0]);
  return (response.text ?? '').trim();
}

/** 根据“生成后的图片”（场景图/风格图）提取可复用的场景生图提示词。 */
export async function extractScenePromptFromImageGemini(
  ai: GoogleGenAI,
  model: string,
  imageDataUrl: string,
  language: 'en' | 'zh' = 'zh'
): Promise<string> {
  const parsed = parseDataUrl(imageDataUrl);
  if (!parsed) throw new Error('请提供有效的图片 dataURL');
  const isZh = language === 'zh';
  const textZh = `你是电商场景图提示词专家。请根据上方图片内容，提取并输出一条“可复用的场景生图提示词”（简体中文）。要求：
1) 重点描述：背景/场景、光线、镜头/构图、色调、材质质感、氛围、道具与环境细节。
2) 产品主体请用占位符表示：用「【产品主体】」代替具体产品，不要写死产品名称。
3) 输出为一段完整提示词，便于直接用于再次生图；不要输出编号、不要输出分析过程、不要加引号或 markdown。`;
  const textEn = `You are an expert at writing reusable scene prompts for e-commerce images. Based on the image above, output ONE reusable scene image-generation prompt in English.\nRequirements:\n- Focus on background/setting, lighting, camera/composition, color grading, materials/texture, mood, props and environmental details.\n- Replace the product with a placeholder \"[PRODUCT SUBJECT]\"; do not hardcode the actual product name.\n- Output only the prompt, no analysis, no bullets, no markdown.`;
  const contents = [
    { role: 'user' as const, parts: [{ text: isZh ? textZh : textEn }, { inlineData: parsed }] },
  ];
  const response = await ai.models.generateContent({
    model: model || 'gemini-2.0-flash',
    contents,
  } as Parameters<GoogleGenAI['models']['generateContent']>[0]);
  return (response.text ?? '').trim();
}

const FULLSET_FROM_IMAGES_EN = `Based on the product reference image(s) above, return ONLY a valid JSON object with exactly two keys:
- "mainPrompts": array of exactly 5 strings. Each is a detailed prompt for a product MAIN image (white or minimal background, professional lighting, different angle or composition: e.g. front, 45°, side, top, lifestyle flatlay). Describe based on the product in the image(s).
- "detailPrompts": array of exactly 5 strings. Each is a detailed prompt for a product DETAIL/section image (e.g. close-up texture, detail shot, usage scene, dimension reference, packaging or lifestyle).
No other text, no markdown, only the JSON object.`;

const FULLSET_FROM_IMAGES_ZH = `根据以上产品参考图，只返回一个合法的 JSON 对象，且仅包含两个键：
- "mainPrompts": 长度为 5 的字符串数组。每条为一张产品主图的中文详细提示词（白底或简约背景、专业光影，5 张分别不同角度或构图：如正面、45°、侧面、俯视、场景平铺）。根据图中产品描述。
- "detailPrompts": 长度为 5 的字符串数组。每条为一张产品详情/场景图的中文详细提示词（如材质特写、细节、使用场景、尺寸参照、包装或生活场景等）。
所有提示词必须使用简体中文。不要其他文字或 markdown，只输出该 JSON 对象。`;

/** 根据产品主图（垫图）生成全套 5 主图 + 5 详情图提示词。仅文本模型。 */
export async function generateFullSetImagePromptsFromImagesGemini(
  ai: GoogleGenAI,
  model: string,
  baseImages: string[],
  language: 'en' | 'zh' = 'en'
): Promise<{ mainPrompts: string[]; detailPrompts: string[] }> {
  const validImages = baseImages.filter((u): u is string => typeof u === 'string' && u.startsWith('data:')).map(parseDataUrl).filter(Boolean) as { mimeType: string; data: string }[];
  if (validImages.length === 0) throw new Error('请至少提供一张垫图');
  const isZh = language === 'zh';
  const textPart = isZh ? FULLSET_FROM_IMAGES_ZH : FULLSET_FROM_IMAGES_EN;
  const contents = [
    { role: 'user' as const, parts: [{ text: textPart }, ...validImages.map((img) => ({ inlineData: img }))] },
  ];
  const response = await ai.models.generateContent({
    model: model || 'gemini-2.0-flash',
    contents,
  } as Parameters<GoogleGenAI['models']['generateContent']>[0]);
  const raw = (response.text ?? '').trim().replace(/^```json?\s*|\s*```$/g, '');
  try {
    const parsed = JSON.parse(raw) as { mainPrompts?: string[]; detailPrompts?: string[] };
    const main = Array.isArray(parsed.mainPrompts) ? parsed.mainPrompts.slice(0, 5) : [];
    const detail = Array.isArray(parsed.detailPrompts) ? parsed.detailPrompts.slice(0, 5) : [];
    return {
      mainPrompts: main.length >= 5 ? main : [...main, ...Array(5 - main.length).fill('')],
      detailPrompts: detail.length >= 5 ? detail : [...detail, ...Array(5 - detail.length).fill('')],
    };
  } catch {
    return { mainPrompts: [], detailPrompts: [] };
  }
}

const FULLSET_SYSTEM_EN = `You are an expert at e-commerce product photography prompts. Return ONLY a valid JSON object with exactly two keys:
- "mainPrompts": array of exactly 5 strings. Each is a detailed prompt for a product MAIN image (white or minimal background, professional lighting, different angle or composition per image: e.g. front, 45°, side, top, lifestyle flatlay).
- "detailPrompts": array of exactly 5 strings. Each is a detailed prompt for a product DETAIL/section image (e.g. close-up texture, detail shot, usage scene, dimension/size reference, packaging or lifestyle scene).
No other text, no markdown, only the JSON object.`;

const FULLSET_SYSTEM_ZH = `你是电商产品摄影提示词专家。【重要】所有 mainPrompts 和 detailPrompts 数组中的每一条提示词内容必须使用简体中文描述，不要使用英文。
只返回一个合法的 JSON 对象，且仅包含两个键：
- "mainPrompts": 长度为 5 的字符串数组。每条为一张产品主图的中文详细提示词（白底或简约背景、专业光影，5 张分别不同角度或构图：如正面、45°、侧面、俯视、场景平铺）。
- "detailPrompts": 长度为 5 的字符串数组。每条为一张产品详情/场景图的中文详细提示词（如材质特写、细节、使用场景、尺寸参照、包装或生活场景等）。
不要其他文字或 markdown，只输出该 JSON 对象。`;

export async function generateFullSetImagePromptsGemini(
  ai: GoogleGenAI,
  model: string,
  productInfo: string,
  language: 'en' | 'zh' = 'en'
): Promise<{ mainPrompts: string[]; detailPrompts: string[] }> {
  const isZh = language === 'zh';
  const system = isZh ? FULLSET_SYSTEM_ZH : FULLSET_SYSTEM_EN;
  const user = isZh
    ? `产品信息：\n${productInfo}\n\n请根据以上产品信息生成 5 条主图提示词 + 5 条详情图提示词，全部用简体中文书写，不要英文。`
    : `Product information:\n${productInfo}`;
  const response = await ai.models.generateContent({
    model: model || 'gemini-2.0-flash',
    contents: `${system}\n\n${user}`,
  });
  const raw = (response.text ?? '').trim().replace(/^```json?\s*|\s*```$/g, '');
  try {
    const parsed = JSON.parse(raw) as { mainPrompts?: string[]; detailPrompts?: string[] };
    const main = Array.isArray(parsed.mainPrompts) ? parsed.mainPrompts.slice(0, 5) : [];
    const detail = Array.isArray(parsed.detailPrompts) ? parsed.detailPrompts.slice(0, 5) : [];
    return {
      mainPrompts: main.length >= 5 ? main : [...main, ...Array(5 - main.length).fill('')],
      detailPrompts: detail.length >= 5 ? detail : [...detail, ...Array(5 - detail.length).fill('')],
    };
  } catch {
    return { mainPrompts: [], detailPrompts: [] };
  }
}

/**
 * 基于「已有成品图」的精修指令，拼成发给 Gemini 图像模型的完整提示（图+文由 generateImageGemini 处理）。
 */
export function buildImageRefinePrompt(userInstruction: string, language: 'en' | 'zh'): string {
  const t = userInstruction.trim();
  if (!t) return '';
  if (language === 'zh') {
    return (
      '这是一张已生成的电商营销图。请在尽量保持产品主体、品牌与卖点信息可读、整体构图不被破坏的前提下，按以下要求进行视觉精修（不要换成完全不同的另一件商品或另一张无关图）：\n\n' +
      `【精修要求】\n${t}\n\n` +
      '若要求涉及画面中中文文案：必须与用户给出的每个汉字完全一致，禁止形近错字。输出一张完整、清晰、可直接用于电商详情/主图的成品图。'
    );
  }
  return (
    'This is an existing e-commerce marketing image. Refine it visually while keeping the product identity, brand/selling text readable, and the overall layout intact (do not replace with a totally different product or unrelated image). Requirements:\n\n' +
    `【Refinement】\n${t}\n\n` +
    'Output one complete, sharp, ready-to-use e-commerce image.'
  );
}

/**
 * 店铺页「在原图上改版并替换展示」：强调同一产品、可替换主图/详情图（Nano Banana 2 等 Gemini 图像模型）。
 */
export function buildEcomShopRemixPrompt(userInstruction: string, language: 'en' | 'zh'): string {
  const t = userInstruction.trim();
  if (!t) return '';
  if (language === 'zh') {
    return (
      '这是店铺商品展示用图。请在**严格保持同一产品**（造型、颜色、款式、比例一致，不可替换为其他商品或模型）的前提下，按以下要求生成一张**可直接替换当前展位**的新版本电商图（主图或详情图用途）：\n\n' +
      `【改版要求】\n${t}\n\n` +
      '若画面含中文文案：必须与用户给出的每个汉字完全一致。输出单张完整、清晰、专业光影的成品图。'
    );
  }
  return (
    'This is a product image used on an e-commerce storefront. Generate ONE new version that can **replace the current listing image**, while **strictly keeping the same product** (same shape, color, variant, proportions—do not substitute a different product). Requirements:\n\n' +
    `【Changes】\n${t}\n\n` +
    'Output one complete, sharp, professionally lit e-commerce ready image.'
  );
}

/** 含中文时追加说明：图像模型画字易错字，仅能尽量约束，无法从工具侧根治 */
function appendChineseTypographyHint(prompt: string): string {
  if (!/[\u4e00-\u9fff]/.test(prompt)) return prompt;
  return (
    `${prompt}\n\n` +
    '【中文文字】若画面中需要显示中文，必须与上文用户给出的汉字、数字、标点逐字一致，禁止改成形近字、同音别字或乱码式汉字。' +
    '若难以在图中稳定还原复杂中文，请优先保证产品与构图，文字区域用清晰易认的印刷体；仍无法保证时宁可留白也不要输出错误汉字。'
  );
}

/** 解析 data URL 为 mimeType + base64 data */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  if (!dataUrl?.startsWith('data:')) return null;
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/** 使用 Gemini 原生图像模型生成图片，返回 base64 data URL。支持单张或多张垫图；多张时模型会参考全部图片并按提示词对比/调整。 */
export async function generateImageGemini(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  baseImage?: string | string[]
): Promise<string> {
  const imageModel = model || 'gemini-2.5-flash-image';
  const promptForModel = appendChineseTypographyHint(prompt);
  const baseImages = Array.isArray(baseImage) ? baseImage : baseImage ? [baseImage] : [];
  const validImages = baseImages.filter((u): u is string => typeof u === 'string' && u.startsWith('data:')).map(parseDataUrl).filter(Boolean) as { mimeType: string; data: string }[];

  let contents: unknown = promptForModel;
  if (validImages.length === 1) {
    contents = [
      {
        role: 'user',
        parts: [
          { text: promptForModel },
          { inlineData: validImages[0] },
        ],
      },
    ];
  } else if (validImages.length >= 2) {
    const textPart = `以下是 ${validImages.length} 张参考图。请根据用户要求对它们进行对比、取舍或融合后生成新图（例如：保留某张的构图、某张的色调、或综合多张优点）。用户要求：\n\n${promptForModel}`;
    contents = [
      {
        role: 'user',
        parts: [
          { text: textPart },
          ...validImages.map((img) => ({ inlineData: img })),
        ],
      },
    ];
  }

  const IMAGE_TIMEOUT_MS = 90_000;
  const response = await Promise.race([
    ai.models.generateContent({
      model: imageModel,
      contents,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    } as Parameters<GoogleGenAI['models']['generateContent']>[0]),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(
        `Gemini 生图超时（${IMAGE_TIMEOUT_MS / 1000} 秒未返回）。可能原因：① 网络不稳定；② 模型繁忙。请稍后重试，或换「Nano Banana」模型。`
      )), IMAGE_TIMEOUT_MS)
    ),
  ]);
  const res = response as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> };
    }>;
    promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
    text?: string;
  };

  const blockReason = res.promptFeedback?.blockReason;
  if (blockReason) {
    const msg = res.promptFeedback?.blockReasonMessage;
    throw new Error(
      `Gemini 提示词未通过安全策略：${blockReason}${msg ? `（${msg}）` : ''}。请缩短/改写提示词或换一张垫图再试。`
    );
  }

  const candidates = res.candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType || 'image/png';
      return `data:${mime};base64,${part.inlineData.data}`;
    }
  }

  const finish = candidates?.[0]?.finishReason;
  const textHint = typeof res.text === 'string' && res.text.trim() ? res.text.trim().slice(0, 400) : '';
  const hint = [
    'Gemini 未返回图片',
    finish ? `（finishReason: ${finish}）` : '',
    textHint ? `。模型返回文本：${textHint}` : '',
    '。若多次出现：请尝试换成「Nano Banana」模型（gemini-2.5-flash-image）、或减少垫图数量/缩小垫图体积。',
  ].join('');
  throw new Error(hint);
}
