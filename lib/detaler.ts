import OpenAI from 'openai';

const DETALER_BASE_URL = process.env.DETALER_BASE_URL || 'https://dataler.com/v1';

export function createDetaler(apiKey: string) {
  const key = apiKey?.trim();
  if (!key) throw new Error('Detaler API Key 未配置');
  return new OpenAI({
    apiKey: key,
    baseURL: DETALER_BASE_URL,
  });
}

