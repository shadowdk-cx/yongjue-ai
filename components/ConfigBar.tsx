'use client';

import { Settings } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const GEMINI_TEXT_MODELS = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
];

const OPENAI_TEXT_MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
];

const OPENROUTER_TEXT_MODELS = [
  { value: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o Mini (OpenRouter)' },
  { value: 'openai/gpt-4o', label: 'OpenAI GPT-4o (OpenRouter)' },
  { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash (OpenRouter)' },
  { value: 'qwen/qwen2.5-72b-instruct', label: 'Qwen2.5 72B (OpenRouter)' },
];

const GEMINI_IMAGE_MODELS = [
  { value: 'gemini-2.5-flash-image', label: 'Nano Banana（Gemini 2.5 Flash）' },
  { value: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2' },
  { value: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' },
  { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash Exp' },
];

const OPENAI_IMAGE_MODELS = [
  { value: 'dall-e-3', label: 'DALL-E 3' },
  { value: 'dall-e-2', label: 'DALL-E 2' },
];

const OPENROUTER_IMAGE_MODELS = [
  { value: 'google/gemini-3.1-flash-image', label: 'Banana 2（OpenRouter）' },
  { value: 'google/gemini-3.1-flash-image', label: 'Nano Banana 2（OpenRouter）' },
  { value: 'google/gemini-2.5-flash-image', label: 'Nano Banana（OpenRouter）' },
  { value: 'google/gemini-3-pro-image', label: 'Nano Banana Pro（OpenRouter）' },
];

const DETALER_TEXT_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Detaler)' },
  { value: 'gpt-4o', label: 'GPT-4o (Detaler)' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (Detaler)' },
  { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet (Detaler)' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Detaler)' },
  { value: 'qwen-plus', label: 'Qwen Plus (Detaler)' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat (Detaler)' },
];

const DETALER_IMAGE_MODELS = [
  { value: 'nano-banana-2.0-exp', label: 'Nano Banana 2.0（Detaler 实验）' },
  { value: 'chatgpt-image-2.0', label: 'ChatGPT Image 2.0（Detaler）' },
  { value: 'gpt-image-1', label: 'gpt-image-1 (Detaler)' },
  { value: 'gpt-image-1.5', label: 'gpt-image-1.5 (Detaler)' },
];

/** 阿里云百炼：通义千问（OpenAI 兼容模式） */
const QWEN_TEXT_MODELS = [
  { value: 'qwen-plus', label: 'Qwen Plus' },
  { value: 'qwen-turbo', label: 'Qwen Turbo' },
  { value: 'qwen-max', label: 'Qwen Max' },
  { value: 'qwen2.5-72b-instruct', label: 'Qwen2.5 72B' },
];

/** 万相文生图（需中国内地地域 API Key） */
const QWEN_IMAGE_MODELS = [{ value: 'wanx-v1', label: '万相 wanx-v1（文生图）' }];

const VIDEO_MODELS = [
  { value: 'veo-2.0-generate-001', label: 'Gemini Veo 2' },
  { value: 'veo-3.1-generate-preview', label: 'Gemini Veo 3.1' },
  { value: 'runway', label: 'Runway Gen-3' },
  { value: 'kling', label: 'Kling' },
  { value: 'luma', label: 'Luma Dream Machine' },
];

type ConfigBarProps = {
  provider: 'gemini' | 'openai' | 'qwen' | 'openrouter' | 'detaler';
  setProvider: (v: 'gemini' | 'openai' | 'qwen' | 'openrouter' | 'detaler') => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  videoApiKey: string;
  setVideoApiKey: (v: string) => void;
  textModel: string;
  setTextModel: (v: string) => void;
  imageModel: string;
  setImageModel: (v: string) => void;
  videoModel: string;
  setVideoModel: (v: string) => void;
};

export function ConfigBar({
  provider,
  setProvider,
  apiKey,
  setApiKey,
  videoApiKey,
  setVideoApiKey,
  textModel,
  setTextModel,
  imageModel,
  setImageModel,
  videoModel,
  setVideoModel,
}: ConfigBarProps) {
  const { t } = useI18n();
  const textModels =
    provider === 'gemini'
      ? GEMINI_TEXT_MODELS
      : provider === 'qwen'
        ? QWEN_TEXT_MODELS
        : provider === 'openrouter'
          ? OPENROUTER_TEXT_MODELS
          : provider === 'detaler'
            ? DETALER_TEXT_MODELS
          : OPENAI_TEXT_MODELS;
  const imageModels =
    provider === 'gemini'
      ? GEMINI_IMAGE_MODELS
      : provider === 'qwen'
        ? QWEN_IMAGE_MODELS
        : provider === 'openrouter'
          ? OPENROUTER_IMAGE_MODELS
          : provider === 'detaler'
            ? DETALER_IMAGE_MODELS
          : OPENAI_IMAGE_MODELS;
  const textValue = textModels.some((m) => m.value === textModel) ? textModel : textModels[0]?.value ?? '';
  const imageValue = imageModels.some((m) => m.value === imageModel) ? imageModel : imageModels[0]?.value ?? '';

  return (
    <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-2 flex flex-wrap items-center gap-4 shrink-0">
      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
        <Settings className="w-4 h-4" />
        <span className="text-sm font-medium">{t('配置', 'Settings')}</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{t('服务商', 'Provider')}</label>
        <select
          value={provider}
          onChange={(e) => {
            const p = e.target.value as 'gemini' | 'openai' | 'qwen' | 'openrouter' | 'detaler';
            setProvider(p);
            if (p === 'gemini') {
              setTextModel(GEMINI_TEXT_MODELS[0]?.value ?? 'gemini-2.0-flash');
              setImageModel(GEMINI_IMAGE_MODELS[0]?.value ?? 'gemini-2.5-flash-image');
            } else if (p === 'qwen') {
              setTextModel(QWEN_TEXT_MODELS[0]?.value ?? 'qwen-plus');
              setImageModel(QWEN_IMAGE_MODELS[0]?.value ?? 'wanx-v1');
            } else if (p === 'openrouter') {
              setTextModel(OPENROUTER_TEXT_MODELS[0]?.value ?? 'openai/gpt-4o-mini');
              setImageModel(OPENROUTER_IMAGE_MODELS[0]?.value ?? 'google/gemini-3.1-flash-image');
            } else if (p === 'detaler') {
              setTextModel(DETALER_TEXT_MODELS[0]?.value ?? 'gpt-4o-mini');
              setImageModel(DETALER_IMAGE_MODELS[0]?.value ?? 'gpt-image-1');
            } else {
              setTextModel(OPENAI_TEXT_MODELS[0]?.value ?? 'gpt-4o');
              setImageModel(OPENAI_IMAGE_MODELS[0]?.value ?? 'dall-e-3');
            }
          }}
          className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
        >
          <option value="gemini">{t('Gemini（仅需一个 API Key）', 'Gemini (single API Key)')}</option>
          <option value="openai">OpenAI</option>
          <option value="qwen">{t('通义千问（阿里云百炼 DashScope）', 'Qwen (Alibaba DashScope)')}</option>
          <option value="openrouter">OpenRouter</option>
          <option value="detaler">Detaler.com</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">
          {provider === 'gemini'
            ? 'Gemini API Key'
            : provider === 'qwen'
              ? 'DashScope API Key'
              : provider === 'openrouter'
                ? 'OpenRouter API Key'
                : provider === 'detaler'
                  ? 'Detaler API Key'
                : 'OpenAI API Key'}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            provider === 'gemini'
              ? 'Gemini Key (AIza…)' : provider === 'qwen'
                ? 'sk-…（百炼控制台）'
                : provider === 'openrouter'
                  ? 'sk-or-...'
                  : provider === 'detaler'
                    ? 'sk-...'
                  : 'sk-...'
          }
          className="w-64 px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-sky-500 focus:border-transparent"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{t('视频 API Key', 'Video API Key')}</label>
        <input
          type="password"
          value={videoApiKey}
          onChange={(e) => setVideoApiKey(e.target.value)}
          placeholder={t('Runway Key（可选，仅视频）', 'Runway Key (optional, video only)')}
          className="w-48 px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-sky-500 focus:border-transparent"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{t('生文模型', 'Text Model')}</label>
        <select
          value={textValue}
          onChange={(e) => setTextModel(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
        >
          {textModels.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{t('生图模型', 'Image Model')}</label>
        <select
          value={imageValue}
          onChange={(e) => setImageModel(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
        >
          {imageModels.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{t('视频模型', 'Video Model')}</label>
        <select
          value={videoModel}
          onChange={(e) => setVideoModel(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
        >
          {VIDEO_MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
