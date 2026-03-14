'use client';

import { Settings } from 'lucide-react';

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

const GEMINI_IMAGE_MODELS = [
  { value: 'gemini-2.5-flash-image', label: 'Nano Banana（Gemini 2.5 Flash 生图）' },
  { value: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2' },
  { value: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' },
  { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash Exp（实验）' },
];

const OPENAI_IMAGE_MODELS = [
  { value: 'dall-e-3', label: 'DALL-E 3' },
  { value: 'dall-e-2', label: 'DALL-E 2' },
];

const VIDEO_MODELS = [
  { value: 'veo-2.0-generate-001', label: 'Gemini Veo 2' },
  { value: 'veo-3.1-generate-preview', label: 'Gemini Veo 3.1' },
  { value: 'runway', label: 'Runway Gen-3' },
  { value: 'kling', label: '可灵 Kling' },
  { value: 'luma', label: 'Luma Dream Machine' },
];

type ConfigBarProps = {
  provider: 'gemini' | 'openai';
  setProvider: (v: 'gemini' | 'openai') => void;
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
  const textModels = provider === 'gemini' ? GEMINI_TEXT_MODELS : OPENAI_TEXT_MODELS;
  const imageModels = provider === 'gemini' ? GEMINI_IMAGE_MODELS : OPENAI_IMAGE_MODELS;
  const textValue = textModels.some((m) => m.value === textModel) ? textModel : textModels[0]?.value ?? '';
  const imageValue = imageModels.some((m) => m.value === imageModel) ? imageModel : imageModels[0]?.value ?? '';

  return (
    <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-2 flex flex-wrap items-center gap-4 shrink-0">
      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
        <Settings className="w-4 h-4" />
        <span className="text-sm font-medium">配置</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">服务商</label>
        <select
          value={provider}
          onChange={(e) => {
            const p = e.target.value as 'gemini' | 'openai';
            setProvider(p);
            if (p === 'gemini') {
              setTextModel(GEMINI_TEXT_MODELS[0]?.value ?? 'gemini-2.0-flash');
              setImageModel(GEMINI_IMAGE_MODELS[0]?.value ?? 'gemini-2.5-flash-image');
            } else {
              setTextModel(OPENAI_TEXT_MODELS[0]?.value ?? 'gpt-4o');
              setImageModel(OPENAI_IMAGE_MODELS[0]?.value ?? 'dall-e-3');
            }
          }}
          className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
        >
          <option value="gemini">Gemini（仅需一个 API Key）</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{provider === 'gemini' ? 'Gemini API Key' : 'OpenAI API Key'}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider === 'gemini' ? 'Gemini Key (AIza…)' : 'sk-…'}
          className="w-64 px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-sky-500 focus:border-transparent"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">视频 API Key</label>
        <input
          type="password"
          value={videoApiKey}
          onChange={(e) => setVideoApiKey(e.target.value)}
          placeholder="Runway Key（可选，仅视频）"
          className="w-48 px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-sky-500 focus:border-transparent"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">生文模型</label>
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
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">生图模型</label>
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
        <label className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">视频模型</label>
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
