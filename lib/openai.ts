import OpenAI from 'openai';

export function createOpenAI(apiKey: string) {
  if (!apiKey?.trim()) throw new Error('API Key 未配置');
  return new OpenAI({ apiKey: apiKey.trim() });
}

export const PARSE_SYSTEM = `你是一个电商产品分析助手。请根据用户提供的产品信息，提取并输出以下结构化字段（每项用简短清晰的文本，若无法推断可留空）：
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

export async function parseProduct(openai: OpenAI, model: string, productInfo: string): Promise<Record<string, string>> {
  const completion = await openai.chat.completions.create({
    model: model === 'deepseek-chat' ? 'deepseek-chat' : model,
    messages: [
      { role: 'system', content: PARSE_SYSTEM },
      { role: 'user', content: productInfo },
    ],
    temperature: 0.3,
  });
  const content = completion.choices[0]?.message?.content?.trim() || '{}';
  try {
    const parsed = JSON.parse(content.replace(/^```json?\s*|\s*```$/g, ''));
    return typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function generateCopy(
  openai: OpenAI,
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

  const completion = await openai.chat.completions.create({
    model: model === 'deepseek-chat' ? 'deepseek-chat' : model,
    messages: [{ role: 'user', content: userContent }],
    temperature: 0.6,
  });
  const raw = completion.choices[0]?.message?.content?.trim() || '';

  const titleMatch = raw.match(/-{2,}\s*标题?\s*-{2,}\s*([\s\S]*?)(?=-{2,}|$)/i) || raw.match(/标题[：:]\s*([^\n]+)/);
  const bulletsMatch = raw.match(/-{2,}\s*卖点?\s*-{2,}\s*([\s\S]*?)(?=-{2,}|$)/i) || raw.match(/卖点[：:]\s*([\s\S]*?)(?=详情|描述|-{2,}|$)/i);
  const descMatch = raw.match(/-{2,}\s*详情?\s*-{2,}\s*([\s\S]*?)(?=$)/i) || raw.match(/详情[：:]\s*([\s\S]*)/i);

  return {
    title: (titleMatch?.[1] || raw.split('\n')[0] || '').trim(),
    bullets: (bulletsMatch?.[1] || '').trim(),
    description: (descMatch?.[1] || '').trim(),
  };
}

export async function generateImagePrompt(
  openai: OpenAI,
  model: string,
  productInfo: string,
  language: 'en' | 'zh' = 'en'
): Promise<string> {
  const isZh = language === 'zh';
  const system = isZh
    ? '你是电商产品图生图提示词专家。请根据产品信息，输出一条详细的中文生图提示词：白底或简约背景、专业光影、产品主体清晰。不要代码或多余说明，只输出这一条提示词。'
    : 'You are an expert at writing image generation prompts for e-commerce product photos. Output a single, detailed English prompt for a high-quality product image: white or minimal background, professional lighting, clear product focus. No code or extra text, only the prompt.';
  const user = isZh
    ? `产品信息：\n${productInfo}\n\n请用中文写一条详细的生图提示词。`
    : `Product information:\n${productInfo}\n\nWrite one detailed image generation prompt in English.`;
  const completion = await openai.chat.completions.create({
    model: model === 'deepseek-chat' ? 'deepseek-chat' : model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.7,
  });
  return completion.choices[0]?.message?.content?.trim() || '';
}

const FULLSET_SYSTEM_EN = `You are an expert at e-commerce product photography prompts. Return ONLY a valid JSON object with exactly two keys:
- "mainPrompts": array of exactly 5 strings. Each is a detailed prompt for a product MAIN image (white or minimal background, professional lighting, different angle or composition per image).
- "detailPrompts": array of exactly 5 strings. Each is a detailed prompt for a product DETAIL/section image (close-up, scene, etc.).
No other text, no markdown, only the JSON object.`;

const FULLSET_SYSTEM_ZH = `你是电商产品摄影提示词专家。【重要】所有 mainPrompts 和 detailPrompts 数组中的每一条提示词内容必须使用简体中文描述，不要使用英文。
只返回一个合法的 JSON 对象，且仅包含两个键：
- "mainPrompts": 长度为 5 的字符串数组。每条为一张产品主图的中文详细提示词（白底或简约背景、专业光影，5 张不同角度或构图）。
- "detailPrompts": 长度为 5 的字符串数组。每条为一张产品详情/场景图的中文详细提示词。
不要其他文字或 markdown，只输出该 JSON 对象。`;

export async function generateFullSetImagePrompts(
  openai: OpenAI,
  model: string,
  productInfo: string,
  language: 'en' | 'zh' = 'en'
): Promise<{ mainPrompts: string[]; detailPrompts: string[] }> {
  const isZh = language === 'zh';
  const system = isZh ? FULLSET_SYSTEM_ZH : FULLSET_SYSTEM_EN;
  const user = isZh
    ? `产品信息：\n${productInfo}\n\n请根据以上产品信息生成 5 条主图提示词 + 5 条详情图提示词，全部用简体中文书写，不要英文。`
    : `Product information:\n${productInfo}`;
  const completion = await openai.chat.completions.create({
    model: model === 'deepseek-chat' ? 'deepseek-chat' : model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.7,
  });
  const raw = (completion.choices[0]?.message?.content?.trim() ?? '').replace(/^```json?\s*|\s*```$/g, '');
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
