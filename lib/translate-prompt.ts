import { GoogleGenAI } from '@google/genai';

const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

/**
 * 如果提示词包含中日韩文字，用 Gemini Flash 快速翻译成英文。
 * 英文提示词通过 Veo 安全审核的概率更高、生成效果更好。
 * 翻译失败时静默返回原文，不阻塞流程。
 */
export async function translatePromptToEnglish(apiKey: string, prompt: string): Promise<string> {
  if (!CJK_RE.test(prompt)) return prompt;
  try {
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    const res = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `Translate the following video generation prompt to English. Keep it concise and natural. Only output the English translation, nothing else.\n\n${prompt}`,
    });
    const text = res.text?.trim();
    if (text && text.length > 3) {
      console.log(`[translate-prompt] "${prompt}" → "${text}"`);
      return text;
    }
  } catch (e) {
    console.warn('[translate-prompt] 翻译失败，使用原文:', e instanceof Error ? e.message : e);
  }
  return prompt;
}
