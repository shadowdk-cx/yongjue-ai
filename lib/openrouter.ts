import OpenAI from 'openai';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function createOpenRouter(apiKey: string) {
  const key = apiKey?.trim();
  if (!key) throw new Error('OpenRouter API Key 未配置');
  if (!/^sk-or-/i.test(key)) {
    throw new Error('OpenRouter API Key 格式无效（应以 sk-or- 开头）');
  }
  return new OpenAI({
    apiKey: key,
    baseURL: OPENROUTER_BASE_URL,
  });
}

/**
 * OpenRouter 图像生成：通过 chat/completions + modalities=["image","text"]
 * 返回 data:image/...;base64,...
 */
export async function generateImageOpenRouter(
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const client = createOpenRouter(apiKey);
  const res = await client.chat.completions.create({
    model: model || 'google/gemini-3.1-flash-image',
    messages: [{ role: 'user', content: prompt }],
    // OpenRouter 扩展参数，OpenAI 类型未声明，使用 any 兼容
    modalities: ['image', 'text'],
  } as any);

  const choice = res.choices?.[0]?.message as any;
  const content = choice?.content;

  if (typeof content === 'string') {
    const m = content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
    if (m?.[0]) return m[0];
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
        const url = part.image_url.url as string;
        if (url.startsWith('data:image/')) return url;
      }
      if (part?.type === 'output_image' && typeof part?.image_url === 'string') {
        const url = part.image_url as string;
        if (url.startsWith('data:image/')) return url;
      }
      if (typeof part?.text === 'string') {
        const m = part.text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
        if (m?.[0]) return m[0];
      }
    }
  }

  throw new Error('OpenRouter 未返回可解析的图片数据');
}

