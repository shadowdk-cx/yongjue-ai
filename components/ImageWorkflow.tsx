'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trash2, ZoomIn, Image as ImageIcon, Clock, ChevronDown, ChevronUp, X } from 'lucide-react';

type ImageWorkflowProps = { apiKey: string; provider: 'gemini' | 'openai'; textModel?: string; imageModel: string };

const SEP = '\n---\n';

type ImageRecord = {
  id: string;
  time: string;
  promptText: string;
  mainUrls: string[];
  detailUrls: string[];
  singleUrls: string[];
};

const IMAGE_HISTORY_KEY = 'ecom_ai_image_history';
const MAX_IMAGE_HISTORY = 20;

function loadImageHistory(): ImageRecord[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(IMAGE_HISTORY_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveImageHistory(items: ImageRecord[]) {
  try {
    localStorage.setItem(IMAGE_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_IMAGE_HISTORY)));
  } catch { /* ignore */ }
}

export function ImageWorkflow({ apiKey, provider, textModel = 'gpt-4o', imageModel }: ImageWorkflowProps) {
  const [productContext, setProductContext] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [fullSetPrompts, setFullSetPrompts] = useState<{ main: string[]; detail: string[] } | null>(null);
  const [baseImages, setBaseImages] = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [mainGeneratedImages, setMainGeneratedImages] = useState<string[]>([]);
  const [detailGeneratedImages, setDetailGeneratedImages] = useState<string[]>([]);
  const [countGeneratedImages, setCountGeneratedImages] = useState<string[]>([]);
  const [generateCount, setGenerateCount] = useState(3);
  const [selectedGenerated, setSelectedGenerated] = useState<number | null>(null);
  const [size, setSize] = useState('1024x1024');
  const [promptLanguage, setPromptLanguage] = useState<'en' | 'zh'>('en');
  const [loading, setLoading] = useState(false);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageHistory, setImageHistory] = useState<ImageRecord[]>([]);
  const [showImageHistory, setShowImageHistory] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [batchSourceImages, setBatchSourceImages] = useState<string[]>([]);
  const [batchGeneratedImages, setBatchGeneratedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setImageHistory(loadImageHistory()); }, []);

  const addToImageHistory = useCallback((promptText: string, main: string[], detail: string[], single: string[]) => {
    const item: ImageRecord = {
      id: Date.now().toString(),
      time: new Date().toLocaleString('zh-CN'),
      promptText,
      mainUrls: main || [],
      detailUrls: detail || [],
      singleUrls: single || [],
    };
    setImageHistory((prev) => {
      const next = [item, ...prev].slice(0, MAX_IMAGE_HISTORY);
      saveImageHistory(next);
      return next;
    });
  }, []);

  const restoreFromImageHistory = (record: ImageRecord) => {
    setImagePrompt(record.promptText);
    setMainGeneratedImages(record.mainUrls || []);
    setDetailGeneratedImages(record.detailUrls || []);
    setGeneratedImages(record.singleUrls || []);
    setShowImageHistory(false);
  };

  const removeImageHistory = (id: string) => {
    const next = imageHistory.filter((r) => r.id !== id);
    setImageHistory(next);
    saveImageHistory(next);
  };

  const clearImageHistory = () => {
    setImageHistory([]);
    saveImageHistory([]);
  };

  const addBaseImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const count = Math.min(files.length, 8 - baseImages.length);
    if (count <= 0) return;
    const results: (string | null)[] = new Array(count);
    let done = 0;
    for (let i = 0; i < count; i++) {
      const reader = new FileReader();
      const index = i;
      reader.onload = () => {
        results[index] = reader.result as string;
        done++;
        if (done === count) {
          const ordered = results.filter((r): r is string => r != null);
          setBaseImages((prev) => [...prev, ...ordered].slice(0, 8));
        }
      };
      reader.readAsDataURL(files[i]);
    }
    e.target.value = '';
  };

  const MAX_BATCH_SOURCES = 30;
  const addBatchSourceImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const count = Math.min(files.length, MAX_BATCH_SOURCES - batchSourceImages.length);
    if (count <= 0) return;
    const results: (string | null)[] = new Array(count);
    let done = 0;
    for (let i = 0; i < count; i++) {
      const reader = new FileReader();
      const index = i;
      reader.onload = () => {
        results[index] = reader.result as string;
        done++;
        if (done === count) {
          const ordered = results.filter((r): r is string => r != null);
          setBatchSourceImages((prev) => [...prev, ...ordered].slice(0, MAX_BATCH_SOURCES));
        }
      };
      reader.readAsDataURL(files[i]);
    }
    e.target.value = '';
  };

  const generateBatch = async () => {
    const prompt = imagePrompt.trim().split(SEP).map((s) => s.trim()).filter(Boolean)[0] || imagePrompt.trim();
    if (!apiKey || !prompt) {
      setError('请填写 API Key 并输入生图提示词');
      return;
    }
    if (batchSourceImages.length === 0) {
      setError('请先在「批量生成」中添加待处理图片');
      return;
    }
    setError(null);
    setLoading(true);
    setBatchGeneratedImages([]);
    const urls: string[] = [];
    const total = batchSourceImages.length;
    for (let i = 0; i < total; i++) {
      setProgress({ current: i + 1, total, label: `批量 ${i + 1}/${total}` });
      try {
        const refs = [...baseImages, batchSourceImages[i]];
        const res = await fetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            provider,
            model: imageModel,
            prompt,
            size,
            baseImages: refs.length > 0 ? refs : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `第 ${i + 1} 张失败`);
        const url = data.url || data.data?.[0]?.url;
        if (url) {
          urls.push(url);
          setBatchGeneratedImages((prev) => [...prev, url]);
        }
      } catch (e) {
        setProgress(null);
        setError(e instanceof Error ? e.message : `批量第 ${i + 1} 张生成失败`);
        setLoading(false);
        return;
      }
    }
    setProgress(null);
    setLoading(false);
    addToImageHistory(prompt, [], [], urls);
  };

  const generatePrompt = async (fullSet: boolean) => {
    if (!apiKey || !productContext.trim()) {
      setError('请填写 API Key 和产品信息');
      return;
    }
    setError(null);
    setLoadingPrompt(true);
    try {
      const res = await fetch('/api/image/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          provider,
          model: textModel,
          productInfo: productContext,
          language: promptLanguage,
          fullSet: fullSet ?? false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      if (fullSet && data.mainPrompts && data.detailPrompts) {
        setFullSetPrompts({
          main: Array.isArray(data.mainPrompts) ? data.mainPrompts : [],
          detail: Array.isArray(data.detailPrompts) ? data.detailPrompts : [],
        });
        setImagePrompt([...(data.mainPrompts || []), ...(data.detailPrompts || [])].join(SEP));
      } else {
        setImagePrompt(data.prompt || '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoadingPrompt(false);
    }
  };

  const generatePromptFromImages = async (fullSet: boolean) => {
    if (!apiKey) {
      setError('请填写 API Key');
      return;
    }
    if (baseImages.length === 0) {
      setError('请先添加产品主图（垫图）');
      return;
    }
    if (provider !== 'gemini') {
      setError('根据垫图生成 Prompt 仅支持 Gemini，请先在配置栏切换为 Gemini');
      return;
    }
    setError(null);
    setLoadingPrompt(true);
    try {
      const res = await fetch('/api/image/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          provider,
          model: textModel,
          baseImages,
          language: promptLanguage,
          fullSet: fullSet ?? false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      if (fullSet && data.mainPrompts && data.detailPrompts) {
        setFullSetPrompts({
          main: Array.isArray(data.mainPrompts) ? data.mainPrompts : [],
          detail: Array.isArray(data.detailPrompts) ? data.detailPrompts : [],
        });
        setImagePrompt([...(data.mainPrompts || []), ...(data.detailPrompts || [])].join(SEP));
      } else {
        setImagePrompt(data.prompt || '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoadingPrompt(false);
    }
  };

  const getPromptList = (max = 10): string[] => {
    const parts = imagePrompt.trim().split(SEP).map((s) => s.trim()).filter(Boolean);
    return parts.slice(0, max);
  };

  /** 按数量生成时用的提示词列表：取前 count 条，不足则用最后一条重复 */
  const getPromptListForCount = (count: number): string[] => {
    const parts = getPromptList(count);
    if (parts.length === 0) return [];
    const last = parts[parts.length - 1];
    return Array.from({ length: count }, (_, i) => parts[i] ?? last);
  };

  const generateImage = async () => {
    if (!apiKey || !imagePrompt.trim()) {
      setError('请填写 API Key 并先生成或输入绘图提示词');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          provider,
          model: imageModel,
          prompt: imagePrompt,
          size,
          baseImages: baseImages.length > 0 ? baseImages : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生图失败');
      const url = data.url || data.data?.[0]?.url;
      if (url) {
        setGeneratedImages((prev) => [...prev, url]);
        addToImageHistory(imagePrompt, [], [], [url]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生图失败');
    } finally {
      setLoading(false);
    }
  };

  const generateFullSet = async () => {
    const list = getPromptList();
    if (!apiKey || list.length === 0) {
      setError('请先点击「生成全套组图 Prompt（5 主图 + 5 详情）」生成 10 条提示词，或在上方文本框内输入多条提示词（用 --- 分隔）');
      return;
    }
    setError(null);
    setLoading(true);
    setMainGeneratedImages([]);
    setDetailGeneratedImages([]);
    const total = Math.min(list.length, 10);
    const mainUrls: string[] = [];
    const detailUrls: string[] = [];

    for (let i = 0; i < total; i++) {
      const label = i < 5 ? `主图 ${i + 1}` : `详情图 ${i - 4}`;
      setProgress({ current: i + 1, total, label });
      try {
        const res = await fetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            provider,
            model: imageModel,
            prompt: list[i],
            size,
            baseImages: baseImages.length > 0 ? baseImages : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `第 ${i + 1} 张失败`);
        const url = data.url || data.data?.[0]?.url;
        if (url) {
          if (i < 5) {
            mainUrls.push(url);
            setMainGeneratedImages((prev) => [...prev, url]);
          } else {
            detailUrls.push(url);
            setDetailGeneratedImages((prev) => [...prev, url]);
          }
        }
      } catch (e) {
        setProgress(null);
        setError(e instanceof Error ? e.message : `第 ${i + 1} 张生成失败`);
        setLoading(false);
        return;
      }
    }
    setProgress(null);
    setLoading(false);
    addToImageHistory(imagePrompt, mainUrls, detailUrls, []);
  };

  const generateByCount = async () => {
    const count = Math.min(20, Math.max(2, generateCount));
    const list = getPromptListForCount(count);
    if (!apiKey || list.length === 0) {
      setError('请填写 API Key 并在上方输入至少一条生图提示词');
      return;
    }
    setError(null);
    setLoading(true);
    setCountGeneratedImages([]);
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      setProgress({ current: i + 1, total: count, label: `第 ${i + 1} 张` });
      try {
        const res = await fetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            provider,
            model: imageModel,
            prompt: list[i],
            size,
            baseImages: baseImages.length > 0 ? baseImages : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `第 ${i + 1} 张失败`);
        const url = data.url || data.data?.[0]?.url;
        if (url) {
          urls.push(url);
          setCountGeneratedImages((prev) => [...prev, url]);
        }
      } catch (e) {
        setProgress(null);
        setError(e instanceof Error ? e.message : `第 ${i + 1} 张生成失败`);
        setLoading(false);
        return;
      }
    }
    setProgress(null);
    setLoading(false);
    addToImageHistory(imagePrompt, [], [], urls);
  };

  const removeGenerated = (index: number) => {
    setGeneratedImages((prev) => prev.filter((_, i) => i !== index));
    if (selectedGenerated === index) setSelectedGenerated(null);
    else if (selectedGenerated !== null && selectedGenerated > index) setSelectedGenerated(selectedGenerated - 1);
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-[1400px] mx-auto">
        <div className="space-y-4">
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">产品信息 / 生图提示词</h2>
            <textarea
              value={productContext}
              onChange={(e) => setProductContext(e.target.value)}
              placeholder="输入产品标题、卖点、材质、场景等，用于自动生成绘图 Prompt"
              rows={4}
              className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y mb-3"
            />
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-sm text-slate-600 dark:text-slate-400">Prompt 语言</span>
              <select
                value={promptLanguage}
                onChange={(e) => setPromptLanguage(e.target.value as 'en' | 'zh')}
                className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
              >
                <option value="en">英文</option>
                <option value="zh">中文</option>
              </select>
              <button
                type="button"
                onClick={() => generatePrompt(true)}
                disabled={loadingPrompt}
                className="px-4 py-2 text-sm rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 flex items-center gap-2"
              >
                {loadingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                根据产品信息生成全套组图 Prompt（5 主图 + 5 详情）
              </button>
              {baseImages.length > 0 && provider === 'gemini' && (
                <>
                  <button
                    type="button"
                    onClick={() => generatePromptFromImages(false)}
                    disabled={loadingPrompt}
                    className="px-4 py-2 text-sm rounded bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {loadingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    根据垫图生成 1 条 Prompt
                  </button>
                  <button
                    type="button"
                    onClick={() => generatePromptFromImages(true)}
                    disabled={loadingPrompt}
                    className="px-4 py-2 text-sm rounded bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {loadingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    根据垫图生成全套 Prompt
                  </button>
                </>
              )}
            </div>
            <textarea
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder={promptLanguage === 'zh' ? '生图提示词（可手动编辑）。生成全套时请用 --- 分隔多条，前 5 条为主图、后 5 条为详情图' : 'Image prompts (editable). For full set, separate with --- ; first 5 = main, next 5 = detail'}
              rows={6}
              className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y"
            />
          </section>

          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">产品主图（垫图）</h2>
              {baseImages.length > 0 && (
                <span className="text-sm font-medium text-sky-600 dark:text-sky-400">
                  已添加 {baseImages.length} 张{baseImages.length >= 8 ? '（已满）' : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              选择服务商为 <span className="font-semibold">Gemini</span> 时，会结合这里的垫图与上方文字提示生成新图。
              {baseImages.length >= 2 ? ' 当前已添加多张垫图，AI 会<strong>同时参考所有图片</strong>，并按你在生图提示词中的要求进行<strong>对比、取舍或融合</strong>（如：保留第一张构图、第二张色调等）。' : ' 上传多张时，AI 会参考全部垫图并按你的提示词做对比与调整。'}
              若使用 DALL·E，仅支持文字提示，不参考垫图。
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={addBaseImages}
            />
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={baseImages.length >= 8}
                className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> 添加主图
              </button>
              {baseImages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBaseImages([])}
                  className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  清空全部
                </button>
              )}
            </div>
            {baseImages.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 py-8 px-4 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">暂无垫图</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">点击上方「添加主图」上传，已添加的图片会显示在下方</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {baseImages.map((src, i) => (
                  <div key={i} className="relative group">
                    <div
                      className="w-24 h-24 rounded-lg border-2 border-slate-300 dark:border-slate-600 overflow-hidden bg-slate-100 dark:bg-slate-800 cursor-pointer hover:opacity-90"
                      onClick={() => setZoomImageUrl(src)}
                      title="点击放大查看"
                    >
                      <img src={src} alt={`垫图 ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                    <span className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-xs font-medium text-white bg-black/60 rounded-b-md">
                      第 {i + 1} 张{baseImages.length >= 2 ? '（均参与生图）' : i === 0 ? '（生图使用）' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => setBaseImages((p) => p.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-90 hover:opacity-100 shadow"
                      title="删除"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">批量生成：待处理图片</h2>
              {batchSourceImages.length > 0 && (
                <span className="text-sm font-medium text-sky-600 dark:text-sky-400">
                  已添加 {batchSourceImages.length} 张{batchSourceImages.length >= MAX_BATCH_SOURCES ? '（已满）' : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              提示词与上方<strong>产品主图（垫图）</strong>保持不变，对下面每张图分别调用生图：用同一提示词 + 垫图 + 当前这张图，生成一张新图。适合对多张图做统一风格/统一处理。
            </p>
            <input
              ref={batchFileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={addBatchSourceImages}
            />
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => batchFileInputRef.current?.click()}
                disabled={batchSourceImages.length >= MAX_BATCH_SOURCES}
                className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> 添加待处理图片
              </button>
              {batchSourceImages.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setBatchSourceImages([]); setBatchGeneratedImages([]); }}
                  className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  清空
                </button>
              )}
              {batchSourceImages.length > 0 && (
                <button
                  type="button"
                  onClick={generateBatch}
                  disabled={loading}
                  className="px-4 py-2 text-sm rounded bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 flex items-center gap-2"
                >
                  {loading && progress ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  开始批量生成
                </button>
              )}
            </div>
            {batchSourceImages.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 py-6 px-4 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">暂无待处理图片</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">添加多张图片后，将按同一提示词和垫图逐张生成新图</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                {batchSourceImages.map((src, i) => (
                  <div key={i} className="relative flex-shrink-0">
                    <div className="w-16 h-16 rounded border border-slate-300 dark:border-slate-600 overflow-hidden bg-slate-100 dark:bg-slate-800">
                      <img src={src} alt={`待处理 ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                    <span className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-xs font-medium text-white bg-black/60 rounded-b">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setBatchSourceImages((p) => p.filter((_, j) => j !== i));
                        setBatchGeneratedImages((p) => p.filter((_, j) => j !== i));
                      }}
                      className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-xs leading-none"
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
            >
              <option value="1024x1024">1024×1024</option>
              <option value="1792x1024">1792×1024</option>
              <option value="1024x1792">1024×1792</option>
            </select>
            <button
              type="button"
              onClick={generateImage}
              disabled={loading}
              className="px-4 py-2 text-sm rounded bg-slate-500 text-white hover:bg-slate-600 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
              生成 1 张
            </button>
            <button
              type="button"
              onClick={generateFullSet}
              disabled={loading}
              className="px-4 py-2 text-sm rounded bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 flex items-center gap-2"
            >
              {loading && progress ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {progress.current}/{progress.total}（{progress.label}）
                </>
              ) : (
                <>生成全套 10 张（5 主图 + 5 详情）</>
              )}
            </button>
            <span className="text-slate-400 dark:text-slate-500">|</span>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              生成数量
              <input
                type="number"
                min={2}
                max={20}
                value={generateCount}
                onChange={(e) => setGenerateCount(Math.min(20, Math.max(2, parseInt(String(e.target.value), 10) || 2)))}
                className="w-14 px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
              />
              张
            </label>
            <button
              type="button"
              onClick={generateByCount}
              disabled={loading}
              className="px-4 py-2 text-sm rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2"
            >
              {loading && progress ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {progress.current}/{progress.total}
                </>
              ) : (
                <>按数量生成</>
              )}
            </button>
          </div>
          {progress && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
              <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400 mb-2">
                <span>正在生成第 {progress.current}/{progress.total} 张</span>
                <span className="font-medium">{progress.label}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        {/* 生成记录 */}
        <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowImageHistory((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              生成记录 {imageHistory.length > 0 && <span className="text-slate-500 font-normal">({imageHistory.length})</span>}
            </span>
            {showImageHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showImageHistory && (
            <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-3 max-h-80 overflow-y-auto">
              {imageHistory.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">暂无记录，生成单张或全套后会在此显示</p>
              ) : (
                <>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={clearImageHistory}
                      className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      清空全部
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {imageHistory.map((r) => {
                      const isFullSet = r.mainUrls.length > 0 || r.detailUrls.length > 0;
                      const thumb = r.mainUrls[0] || r.detailUrls[0] || r.singleUrls[0];
                      const typeLabel = isFullSet ? '全套' : '单张';
                      const preview = r.promptText.slice(0, 50) + (r.promptText.length > 50 ? '…' : '');
                      return (
                        <li
                          key={r.id}
                          className="flex items-start gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
                        >
                          {thumb && (
                            <div className="flex-shrink-0 w-12 h-12 rounded border border-slate-300 dark:border-slate-600 overflow-hidden bg-slate-200 dark:bg-slate-700">
                              <img src={thumb} alt="" className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span>{r.time}</span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700">{typeLabel}</span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 truncate" title={r.promptText}>
                              {preview}
                            </p>
                            <div className="flex gap-2 mt-1">
                              <button
                                type="button"
                                onClick={() => restoreFromImageHistory(r)}
                                className="text-xs px-2 py-1 rounded bg-sky-500 text-white hover:bg-sky-600"
                              >
                                恢复
                              </button>
                              <button
                                type="button"
                                onClick={() => removeImageHistory(r.id)}
                                className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700"
                              >
                                <X className="w-3 h-3 inline" />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>

        <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-6">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">生成的图片</h2>

          {(mainGeneratedImages.length > 0 || detailGeneratedImages.length > 0) && (
            <>
              {mainGeneratedImages.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">产品主图（{mainGeneratedImages.length} 张）</h3>
                  <div className="flex flex-wrap gap-3">
                    {mainGeneratedImages.map((url, i) => (
                      <div key={`main-${i}`} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <img src={url} alt={`主图 ${i + 1}`} className="w-36 h-36 object-cover cursor-pointer hover:opacity-90" onClick={() => setZoomImageUrl(url)} />
                        <div className="flex gap-1 p-1 bg-slate-50 dark:bg-slate-800">
                          <span className="text-xs text-slate-500 flex-1">主图 {i + 1}</span>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /></button>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => setMainGeneratedImages((p) => p.filter((_, j) => j !== i))}>删除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detailGeneratedImages.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">产品详情图（{detailGeneratedImages.length} 张）</h3>
                  <div className="flex flex-wrap gap-3">
                    {detailGeneratedImages.map((url, i) => (
                      <div key={`detail-${i}`} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <img src={url} alt={`详情图 ${i + 1}`} className="w-36 h-36 object-cover cursor-pointer hover:opacity-90" onClick={() => setZoomImageUrl(url)} />
                        <div className="flex gap-1 p-1 bg-slate-50 dark:bg-slate-800">
                          <span className="text-xs text-slate-500 flex-1">详情 {i + 1}</span>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /></button>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => setDetailGeneratedImages((p) => p.filter((_, j) => j !== i))}>删除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {generatedImages.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">单张生成</h3>
              <div className="flex flex-wrap gap-3">
                {generatedImages.map((url, i) => (
                  <div key={i} className={selectedGenerated === i ? 'ring-2 ring-sky-500 rounded-lg' : 'rounded-lg'}>
                    <img src={url} alt="" className="w-40 h-40 object-cover rounded-lg cursor-pointer" onClick={() => setSelectedGenerated(i)} />
                    <div className="flex gap-1 mt-1">
                      <button type="button" className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /> 大图</button>
                      <button type="button" className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => removeGenerated(i)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {countGeneratedImages.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">按数量生成（{countGeneratedImages.length} 张）</h3>
              <div className="flex flex-wrap gap-3">
                {countGeneratedImages.map((url, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <img src={url} alt={`第 ${i + 1} 张`} className="w-36 h-36 object-cover cursor-pointer hover:opacity-90" onClick={() => setZoomImageUrl(url)} />
                    <div className="flex gap-1 p-1 bg-slate-50 dark:bg-slate-800">
                      <span className="text-xs text-slate-500 flex-1">第 {i + 1} 张</span>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /></button>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => setCountGeneratedImages((p) => p.filter((_, j) => j !== i))}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batchGeneratedImages.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">批量生成结果（{batchGeneratedImages.length} 张）</h3>
              <div className="flex flex-wrap gap-3">
                {batchGeneratedImages.map((url, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <img src={url} alt={`批量 ${i + 1}`} className="w-36 h-36 object-cover cursor-pointer hover:opacity-90" onClick={() => setZoomImageUrl(url)} />
                    <div className="flex gap-1 p-1 bg-slate-50 dark:bg-slate-800">
                      <span className="text-xs text-slate-500 flex-1">批量 {i + 1}</span>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /></button>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => setBatchGeneratedImages((p) => p.filter((_, j) => j !== i))}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mainGeneratedImages.length === 0 && detailGeneratedImages.length === 0 && generatedImages.length === 0 && countGeneratedImages.length === 0 && batchGeneratedImages.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">生成后将显示于此（可生成 1 张、按数量、批量或全套 10 张）</p>
          )}
        </section>

        {/* 放大预览弹层：同页内显示，避免 data URL 在新标签无法打开 */}
        {zoomImageUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setZoomImageUrl(null)}
          >
            <button
              type="button"
              className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/90 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-white shadow"
              onClick={() => setZoomImageUrl(null)}
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={zoomImageUrl}
              alt="放大预览"
              className="max-w-full max-h-[90vh] w-auto h-auto object-contain rounded shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </div>
  );
}
