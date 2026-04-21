/**
 * 阿里云百炼 DashScope：通义千问（文本）+ 万相 wanx-v1（文生图）
 * 文档：https://help.aliyun.com/zh/model-studio/
 */

import OpenAI from 'openai';
import { PARSE_SYSTEM, generateCopy, generateImagePrompt, generateFullSetImagePrompts } from '@/lib/openai';

const DASHSCOPE_COMPATIBLE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const WANX_SYNTHESIS = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const TASK_POLL_BASE = 'https://dashscope.aliyuncs.com/api/v1/tasks';

function dashscopeOpenAI(apiKey: string) {
  if (!apiKey?.trim()) throw new Error('API Key 未配置');
  return new OpenAI({
    apiKey: apiKey.trim(),
    baseURL: DASHSCOPE_COMPATIBLE,
  });
}

export async function parseProductQwen(apiKey: string, model: string, productInfo: string): Promise<Record<string, string>> {
  const client = dashscopeOpenAI(apiKey);
  const completion = await client.chat.completions.create({
    model: model || 'qwen-plus',
    messages: [
      { role: 'system', content: PARSE_SYSTEM },
      { role: 'user', content: productInfo },
    ],
    temperature: 0.3,
  });
  const content = completion.choices[0]?.message?.content?.trim() || '{}';
  try {
    const parsed = JSON.parse(content.replace(/^```json?\s*|\s*```$/g, ''));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function generateCopyQwen(
  apiKey: string,
  model: string,
  productInfo: string,
  platform: string,
  language: string,
  prompts: { title: string; bullets: string; description: string }
): Promise<{ title: string; bullets: string; description: string }> {
  const client = dashscopeOpenAI(apiKey);
  return generateCopy(client, model || 'qwen-plus', productInfo, platform, language, prompts);
}

export async function generateImagePromptQwen(
  apiKey: string,
  model: string,
  productInfo: string,
  language: 'en' | 'zh' = 'en'
): Promise<string> {
  const client = dashscopeOpenAI(apiKey);
  return generateImagePrompt(client, model || 'qwen-plus', productInfo, language);
}

export async function generateFullSetImagePromptsQwen(
  apiKey: string,
  model: string,
  productInfo: string,
  language: 'en' | 'zh' = 'en'
): Promise<{ mainPrompts: string[]; detailPrompts: string[] }> {
  const client = dashscopeOpenAI(apiKey);
  return generateFullSetImagePrompts(client, model || 'qwen-plus', productInfo, language);
}

const WANX_SIZE: Record<string, string> = {
  '1024x1024': '1024*1024',
  '1024x1792': '720*1280',
  '1792x1024': '1280*720',
};

type TaskOutput = {
  task_id?: string;
  task_status?: string;
  results?: Array<{ url?: string; code?: string; message?: string }>;
};

/**
 * 万相文生图（异步任务 + 轮询）
 */
export async function wanxTextToImage(
  apiKey: string,
  model: string,
  prompt: string,
  sizeKey: string
): Promise<string> {
  const key = apiKey.trim();
  const wanxModel = model?.startsWith('wanx') || model?.startsWith('wan2') ? model : 'wanx-v1';
  const size = WANX_SIZE[sizeKey] || '1024*1024';

  const createRes = await fetch(WANX_SYNTHESIS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: wanxModel,
      input: { prompt: prompt.slice(0, 800) },
      parameters: {
        style: '<auto>',
        size,
        n: 1,
      },
    }),
  });

  const createJson = (await createRes.json().catch(() => ({}))) as {
    output?: TaskOutput;
    message?: string;
    code?: string;
  };

  if (!createRes.ok) {
    throw new Error(createJson.message || createJson.code || `万相创建任务失败 HTTP ${createRes.status}`);
  }

  const taskId = createJson.output?.task_id;
  if (!taskId) {
    throw new Error(createJson.message || '万相未返回 task_id');
  }

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));

    const pollRes = await fetch(`${TASK_POLL_BASE}/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const pollJson = (await pollRes.json().catch(() => ({}))) as {
      output?: TaskOutput;
      message?: string;
    };

    const status = pollJson.output?.task_status;
    if (status === 'SUCCEEDED') {
      const url = pollJson.output?.results?.[0]?.url;
      if (url) return url;
      const err = pollJson.output?.results?.[0]?.message;
      throw new Error(err || '万相任务成功但未返回图片 URL');
    }
    if (status === 'FAILED' || status === 'UNKNOWN') {
      throw new Error(pollJson.message || pollJson.output?.results?.[0]?.message || '万相生成失败');
    }
  }

  throw new Error('万相生成超时（3 分钟）');
}
