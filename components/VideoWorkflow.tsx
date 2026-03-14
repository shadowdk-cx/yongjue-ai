'use client';

import { useState, useRef } from 'react';
import { Loader2, Image as ImageIcon, Video, Upload } from 'lucide-react';

type VideoWorkflowProps = { apiKey: string; videoApiKey: string; videoModel: string };

type TabMode = 'image2video' | 'text2video';

export function VideoWorkflow({ apiKey, videoApiKey, videoModel }: VideoWorkflowProps) {
  const effectiveKey = videoModel?.startsWith('veo-') ? apiKey : videoApiKey;
  const [mode, setMode] = useState<TabMode>('image2video');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [textScript, setTextScript] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const runImage2Video = async () => {
    if (!effectiveKey || !imageDataUrl) {
      setError(videoModel?.startsWith('veo-') ? '请填写 Gemini API Key（配置栏）并上传一张图片' : '请填写视频 API Key（Runway）并上传一张图片');
      return;
    }
    setError(null);
    setLoading(true);
    setGeneratedVideoUrl(null);
    try {
      const res = await fetch('/api/video/image2video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: effectiveKey,
          model: videoModel,
          imageDataUrl,
          prompt: videoPrompt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '图生视频失败');
      setGeneratedVideoUrl(data.videoUrl || data.url || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '图生视频失败');
    } finally {
      setLoading(false);
    }
  };

  const runText2Video = async () => {
    if (!effectiveKey || !textScript.trim()) {
      setError(videoModel?.startsWith('veo-') ? '请填写 Gemini API Key（配置栏）和视频描述/脚本' : '请填写视频 API Key 和视频描述/脚本');
      return;
    }
    setError(null);
    setLoading(true);
    setGeneratedVideoUrl(null);
    try {
      const res = await fetch('/api/video/text2video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: effectiveKey,
          model: videoModel,
          prompt: textScript,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '文生视频失败');
      setGeneratedVideoUrl(data.videoUrl || data.url || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '文生视频失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          选择 <strong>Gemini Veo 2 / Veo 3.1</strong> 时使用配置栏的 <strong>Gemini API Key</strong>；选择 Runway / 可灵 / Luma 时请填写「视频 API Key」。
        </p>
        <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
          <button
            type="button"
            onClick={() => setMode('image2video')}
            className={`px-4 py-2 rounded-t text-sm font-medium ${mode === 'image2video' ? 'bg-sky-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
          >
            <ImageIcon className="w-4 h-4 inline mr-2" /> 图生视频
          </button>
          <button
            type="button"
            onClick={() => setMode('text2video')}
            className={`px-4 py-2 rounded-t text-sm font-medium ${mode === 'text2video' ? 'bg-sky-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
          >
            <Video className="w-4 h-4 inline mr-2" /> 文生视频
          </button>
        </div>

        {mode === 'image2video' && (
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">图生视频：将产品图转为动态展示</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs text-slate-500 mb-2">上传图片</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onImageSelect}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-48 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center gap-2 text-slate-500 hover:border-sky-500 hover:text-sky-500"
                >
                  {imageDataUrl ? (
                    <img src={imageDataUrl} alt="" className="max-w-full max-h-full object-contain rounded" />
                  ) : (
                    <><Upload className="w-8 h-8" /> 点击上传</>
                  )}
                </button>
                <div className="mt-3">
                  <label className="block text-xs text-slate-500 mb-1">可选：动作/运镜描述（英文更佳）</label>
                  <textarea
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    placeholder="e.g. Slow zoom in, product rotating slightly"
                    rows={2}
                    className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={runImage2Video}
                  disabled={loading}
                  className="w-full py-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 flex items-center justify-center gap-2 mb-4"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
                  {loading ? '生成中…' : '生成视频'}
                </button>
                {generatedVideoUrl && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-2">生成结果</label>
                    <video src={generatedVideoUrl} controls className="w-full rounded-lg border border-slate-200 dark:border-slate-700" />
                    <a href={generatedVideoUrl} download className="mt-2 inline-block text-sm text-sky-500 hover:underline">下载视频</a>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {mode === 'text2video' && (
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">文生视频：根据描述生成宣传短片</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-2">视频描述 / 分镜脚本（英文效果更佳）</label>
                <textarea
                  value={textScript}
                  onChange={(e) => setTextScript(e.target.value)}
                  placeholder="e.g. A minimalist jacket on a mannequin, soft studio lighting, slow 360 rotation, white background"
                  rows={5}
                  className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                />
              </div>
              <button
                type="button"
                onClick={runText2Video}
                disabled={loading}
                className="w-full py-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
                {loading ? '生成中…' : '生成视频'}
              </button>
              {generatedVideoUrl && (
                <div>
                  <label className="block text-xs text-slate-500 mb-2">生成结果</label>
                  <video src={generatedVideoUrl} controls className="w-full rounded-lg border border-slate-200 dark:border-slate-700" />
                  <a href={generatedVideoUrl} download className="mt-2 inline-block text-sm text-sky-500 hover:underline">下载视频</a>
                </div>
              )}
            </div>
          </section>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
