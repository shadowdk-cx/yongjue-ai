'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trash2, ZoomIn, Image as ImageIcon, Clock, ChevronDown, ChevronUp, X, Download, Square, Sparkles, Wand2 } from 'lucide-react';
import { compressImageDataUrl, compressImages } from '@/lib/compress-image';
import { useI18n } from '@/lib/i18n';

type ImageWorkflowProps = { apiKey: string; provider: 'gemini' | 'openai' | 'qwen' | 'openrouter' | 'detaler'; textModel?: string; imageModel: string };

const SEP = '\n---\n';

/** 避免 HTML 错误页导致 res.json() 抛错，只显示「fetch failed」 */
async function readApiJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`服务器返回非 JSON（HTTP ${res.status}）。请在运行工具的终端里查看红色报错。`);
  }
}

function pickImageUrl(data: Record<string, unknown>): string | undefined {
  const u = data.url;
  if (typeof u === 'string' && u) return u;
  const arr = data.data;
  if (Array.isArray(arr) && arr[0] && typeof (arr[0] as { url?: unknown }).url === 'string') {
    const s = (arr[0] as { url: string }).url;
    return s || undefined;
  }
  return undefined;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

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

type StyleMemory = {
  id: string;
  name: string;
  time: string;
  promptText: string;
  /** 生成图作为风格/场景参考（应用时会设为垫图，便于同风格生成其他产品） */
  styleImages?: string[];
};

const STYLE_MEMORY_KEY = 'ecom_ai_style_memory';
const MAX_STYLE_MEMORY = 30;

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

function loadStyleMemory(): StyleMemory[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STYLE_MEMORY_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveStyleMemory(items: StyleMemory[]) {
  try {
    localStorage.setItem(STYLE_MEMORY_KEY, JSON.stringify(items.slice(0, MAX_STYLE_MEMORY)));
  } catch { /* ignore */ }
}

export function ImageWorkflow({ apiKey, provider, textModel = 'gpt-4o', imageModel }: ImageWorkflowProps) {
  const { t, locale } = useI18n();
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
  const [elapsedSec, setElapsedSec] = useState(0);
  const loadingStartRef = useRef(0);

  useEffect(() => {
    if (!loading) { setElapsedSec(0); return; }
    loadingStartRef.current = Date.now();
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - loadingStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [loading]);
  const [scenePromptLoading, setScenePromptLoading] = useState(false);
  const [imageHistory, setImageHistory] = useState<ImageRecord[]>([]);
  const [showImageHistory, setShowImageHistory] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [styleMemories, setStyleMemories] = useState<StyleMemory[]>([]);
  const [styleName, setStyleName] = useState('');
  const [styleNotice, setStyleNotice] = useState<string | null>(null);
  /** 精修：选中的原图 + 用户说明 */
  const [refineSourceUrl, setRefineSourceUrl] = useState<string | null>(null);
  const [refineInstruction, setRefineInstruction] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [batchSourceImages, setBatchSourceImages] = useState<string[]>([]);
  const [batchGeneratedImages, setBatchGeneratedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const refineFileInputRef = useRef<HTMLInputElement>(null);
  const baseSectionRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortRequestedRef = useRef(false);

  const toDataUrl = useCallback(async (url: string): Promise<string> => {
    if (url.startsWith('data:')) return compressImageDataUrl(url);
    const res = await fetch(url);
    const blob = await res.blob();
    const raw = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(t('读取图片失败', 'Failed to read image')));
      reader.readAsDataURL(blob);
    });
    return compressImageDataUrl(raw);
  }, [t]);

  const requestImageGenerate = useCallback(async (
    payload: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const pollDetalerJob = async (jobId: string): Promise<string> => {
      // 与后端 Detaler 一致：实验 Gemini 图像单次最长约 290s + 任务余量，前端略长于服务端避免误判超时
      const deadline = Date.now() + 7 * 60 * 1000;
      let n = 0;
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const res = await fetch(`/api/image/job/${encodeURIComponent(jobId)}`, { signal });
        const data = await readApiJson(res);
        if (!res.ok) throw new Error(String(data.error || t('查询任务失败', 'Failed to query image job')));
        const status = String(data.status || '');
        if (status === 'succeeded') {
          const url = pickImageUrl(data);
          if (!url) throw new Error(t('任务完成但未返回图片', 'Job completed but no image returned'));
          return url;
        }
        if (status === 'failed') throw new Error(String(data.error || t('生图失败', 'Image generation failed')));
        n += 1;
        await sleep(n <= 8 ? 500 : 1000);
      }
      throw new Error(t('生成超时，请稍后重试', 'Generation timeout, please retry'));
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const providerName = String(payload.provider || '');
        const reqPayload =
          providerName === 'detaler'
            ? { ...payload, asyncMode: true }
            : payload;
        const res = await fetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
          signal,
        });
        const data = await readApiJson(res);
        if (!res.ok) throw new Error(String(data.error || t('生图失败', 'Image generation failed')));
        if (providerName === 'detaler' && typeof data.jobId === 'string' && data.jobId) {
          return pollDetalerJob(data.jobId);
        }
        const url = pickImageUrl(data);
        if (!url) throw new Error(t('未返回图片', 'No image returned'));
        return url;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const providerName = String(payload.provider || '');
        const retryable = /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg);
        const shouldRetry = attempt === 0 && retryable && providerName === 'detaler' && !signal?.aborted;
        if (!shouldRetry) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr)));
  }, [t]);

  const extractScenePrompt = useCallback(async (imgUrl: string) => {
    if (!apiKey) {
      setError(t('请先填写 Gemini API Key', 'Please enter your Gemini API Key first'));
      return;
    }
    if (provider !== 'gemini') {
      setError(t('提取图片场景提示词仅支持 Gemini，请先在配置栏切换为 Gemini', 'Extracting scene prompts is only supported with Gemini. Please switch to Gemini in settings.'));
      return;
    }
    setError(null);
    setScenePromptLoading(true);
    try {
      const imageDataUrl = await toDataUrl(imgUrl);
      const res = await fetch('/api/image/scene-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          model: textModel || 'gemini-2.0-flash',
          imageDataUrl,
          language: promptLanguage,
        }),
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(String(data.error || t('提取失败', 'Extraction failed')));
      const prompt = String(data.prompt || '').trim();
      if (!prompt) throw new Error(t('未返回提示词', 'No prompt returned'));
      setImagePrompt(prompt);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('提取失败', 'Extraction failed'));
    } finally {
      setScenePromptLoading(false);
    }
  }, [apiKey, provider, textModel, promptLanguage, toDataUrl, t]);

  /** 基于当前生成图调用服务商做精修，结果插入「单张生成」列表最前 */
  const runImageRefine = useCallback(async () => {
    if (!refineSourceUrl) {
      setError(t('请先点击某张图上的「精修」设为原图，或在大图预览里点「带入精修」', 'Please click "Refine" on an image to set it as source, or click "Refine this" in the zoom preview'));
      return;
    }
    if (!refineInstruction.trim()) {
      setError(t('请填写精修说明（例如：提亮、去背景杂物、加强文字清晰度等）', 'Please enter refine instructions (e.g., brighten, remove background clutter, sharpen text)'));
      return;
    }
    if (provider !== 'gemini' && provider !== 'detaler') {
      setError(t('图片精修需使用 Gemini 或 Detaler', 'Image refine requires Gemini or Detaler'));
      return;
    }
    if (!apiKey) {
      setError(t('请先填写 API Key', 'Please enter your API Key first'));
      return;
    }
    setError(null);
    setRefineLoading(true);
    try {
      const imageDataUrl = await toDataUrl(refineSourceUrl);
      const url = await requestImageGenerate({
        apiKey,
        provider,
        model: imageModel,
        mode: 'refine',
        refineInstruction: refineInstruction.trim(),
        promptLanguage,
        baseImage: imageDataUrl,
        size,
      });
      setGeneratedImages((prev) => [url, ...prev]);
      setSelectedGenerated(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('精修失败', 'Refine failed'));
    } finally {
      setRefineLoading(false);
    }
  }, [
    refineSourceUrl,
    refineInstruction,
    provider,
    apiKey,
    imageModel,
    promptLanguage,
    size,
    toDataUrl,
    t,
    requestImageGenerate,
  ]);

  /** 用户点击停止：中止当前生成 */
  const stopGenerating = useCallback(() => {
    abortRequestedRef.current = true;
    abortControllerRef.current?.abort();
  }, []);

  /** 一键保存图片到本地 */
  const downloadImage = useCallback((url: string, defaultName = 'image.png') => {
    if (!url) return;
    const hasExt = /\.(png|jpe?g|gif|webp)$/i.test(defaultName);
    const name = defaultName.replace(/[^\w\u4e00-\u9fa5\-.]/g, '_') + (hasExt ? '' : '.png');
    if (url.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      return;
    }
    fetch(url, { mode: 'cors' })
      .then((res) => res.blob())
      .then((blob) => {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = name;
        a.click();
        URL.revokeObjectURL(u);
      })
      .catch(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.target = '_blank';
        a.rel = 'noopener';
        a.click();
      });
  }, []);

  useEffect(() => {
    setImageHistory(loadImageHistory());
    setStyleMemories(loadStyleMemory());
  }, []);

  /** 收集当前已生成的图片作为风格参考（最多 3 张，避免 localStorage 过大） */
  const getCurrentGeneratedImages = useCallback(() => {
    const all: string[] = [
      ...mainGeneratedImages,
      ...detailGeneratedImages,
      ...generatedImages,
      ...countGeneratedImages,
      ...batchGeneratedImages,
    ];
    return all.slice(0, 3);
  }, [mainGeneratedImages, detailGeneratedImages, generatedImages, countGeneratedImages, batchGeneratedImages]);

  const addStyleMemory = useCallback(() => {
    const promptText = imagePrompt.trim();
    if (!promptText) {
      setError(t('请先生成或输入生图提示词，再保存为同风格场景记忆', 'Please generate or enter an image prompt first, then save as style memory'));
      return;
    }
    const styleImages = getCurrentGeneratedImages();
    const name = styleName.trim() || t(`风格记忆 ${new Date().toLocaleDateString('zh-CN')}`, `Style Memory ${new Date().toLocaleDateString('en-US')}`);
    const item: StyleMemory = {
      id: Date.now().toString(),
      name,
      time: new Date().toLocaleString('zh-CN'),
      promptText,
      styleImages: styleImages.length > 0 ? styleImages : undefined,
    };
    setStyleMemories((prev) => {
      const next = [item, ...prev].slice(0, MAX_STYLE_MEMORY);
      saveStyleMemory(next);
      return next;
    });
    setStyleName('');
  }, [imagePrompt, styleName, getCurrentGeneratedImages, t]);

  const applyStyleMemory = useCallback((m: StyleMemory) => {
    setImagePrompt(m.promptText);
    setBaseImages(m.styleImages ?? []);
    setError(null);
    setStyleNotice(t(
      `已应用：${m.name}${m.styleImages?.length ? `（${m.styleImages.length} 张风格图）` : ''}`,
      `Applied: ${m.name}${m.styleImages?.length ? ` (${m.styleImages.length} style images)` : ''}`
    ));
    // 让用户直观看到风格图已加载到"垫图"
    setTimeout(() => {
      try { baseSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ }
    }, 0);
    // 3 秒后自动隐藏提示
    setTimeout(() => setStyleNotice(null), 3000);
  }, [t]);

  const removeStyleMemory = useCallback((id: string) => {
    setStyleMemories((prev) => {
      const next = prev.filter((x) => x.id !== id);
      saveStyleMemory(next);
      return next;
    });
  }, []);

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

  const addBaseImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const count = Math.min(files.length, 8 - baseImages.length);
    if (count <= 0) return;
    const readPromises: Promise<string>[] = [];
    for (let i = 0; i < count; i++) {
      readPromises.push(new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(files[i]);
      }));
    }
    const raw = (await Promise.all(readPromises)).filter(Boolean);
    const compressed = await compressImages(raw);
    setBaseImages((prev) => [...prev, ...compressed].slice(0, 8));
    e.target.value = '';
  };

  const MAX_BATCH_SOURCES = 30;
  const addBatchSourceImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const count = Math.min(files.length, MAX_BATCH_SOURCES - batchSourceImages.length);
    if (count <= 0) return;
    const readPromises: Promise<string>[] = [];
    for (let i = 0; i < count; i++) {
      readPromises.push(new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(files[i]);
      }));
    }
    const raw = (await Promise.all(readPromises)).filter(Boolean);
    const compressed = await compressImages(raw);
    setBatchSourceImages((prev) => [...prev, ...compressed].slice(0, MAX_BATCH_SOURCES));
    e.target.value = '';
  };

  const generateBatch = async () => {
    const prompt = imagePrompt.trim().split(SEP).map((s) => s.trim()).filter(Boolean)[0] || imagePrompt.trim();
    if (!apiKey || !prompt) {
      setError(t('请填写 API Key 并输入生图提示词', 'Please enter API Key and image prompt'));
      return;
    }
    if (provider === 'qwen' || provider === 'openrouter') {
      setError(
        t(
          '当前服务商暂不支持「批量 + 垫图参考」：请切换为 Gemini，或改用单张「生成图片」',
          'Current provider does not support batch with reference images. Switch to Gemini or use single-image generation.'
        )
      );
      return;
    }
    if (batchSourceImages.length === 0) {
      setError(t('请先在「批量生成」中添加待处理图片', 'Please add source images in Batch Generate first'));
      return;
    }
    setError(null);
    setLoading(true);
    abortRequestedRef.current = false;
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;
    setBatchGeneratedImages([]);
    const urls: string[] = [];
    const total = batchSourceImages.length;
    for (let i = 0; i < total; i++) {
      if (abortRequestedRef.current) break;
      setProgress({ current: i + 1, total, label: t(`批量 ${i + 1}/${total}`, `Batch ${i + 1}/${total}`) });
      try {
        const refs = provider === 'detaler' ? [batchSourceImages[i]] : [...baseImages, batchSourceImages[i]];
        const url = await requestImageGenerate({
          apiKey,
          provider,
          model: imageModel,
          prompt,
          size,
          baseImages: refs.length > 0 ? refs : undefined,
        }, signal);
        if (url) {
          urls.push(url);
          setBatchGeneratedImages((prev) => [...prev, url]);
        }
      } catch (e) {
        if (abortRequestedRef.current || (e instanceof Error && e.name === 'AbortError')) break;
        setProgress(null);
        setError(e instanceof Error ? e.message : t(`批量第 ${i + 1} 张生成失败`, `Batch image ${i + 1} generation failed`));
        setLoading(false);
        abortControllerRef.current = null;
        return;
      }
    }
    setProgress(null);
    setLoading(false);
    abortControllerRef.current = null;
    if (!abortRequestedRef.current && urls.length > 0) {
      addToImageHistory(prompt, [], [], urls);
    }
  };

  const generatePrompt = async (fullSet: boolean) => {
    if (!apiKey || !productContext.trim()) {
      setError(t('请填写 API Key 和产品信息', 'Please enter API Key and product info'));
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
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(String(data.error || t('生成失败', 'Generation failed')));
      if (fullSet && data.mainPrompts && data.detailPrompts) {
        const main = asStringArray(data.mainPrompts);
        const detail = asStringArray(data.detailPrompts);
        setFullSetPrompts({ main, detail });
        setImagePrompt([...main, ...detail].join(SEP));
      } else {
        setImagePrompt(String(data.prompt || ''));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('生成失败', 'Generation failed'));
    } finally {
      setLoadingPrompt(false);
    }
  };

  const generatePromptFromImages = async (fullSet: boolean) => {
    if (!apiKey) {
      setError(t('请填写 API Key', 'Please enter API Key'));
      return;
    }
    if (baseImages.length === 0) {
      setError(t('请先添加产品主图（垫图）', 'Please add product reference images first'));
      return;
    }
    if (provider !== 'gemini') {
      setError(t('根据垫图生成 Prompt 仅支持 Gemini，请先在配置栏切换为 Gemini', 'Generating prompts from reference images is only supported with Gemini. Please switch to Gemini in settings.'));
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
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(String(data.error || t('生成失败', 'Generation failed')));
      if (fullSet && data.mainPrompts && data.detailPrompts) {
        const main = asStringArray(data.mainPrompts);
        const detail = asStringArray(data.detailPrompts);
        setFullSetPrompts({ main, detail });
        setImagePrompt([...main, ...detail].join(SEP));
      } else {
        setImagePrompt(String(data.prompt || ''));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('生成失败', 'Generation failed'));
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
      setError(t('请填写 API Key 并先生成或输入绘图提示词', 'Please enter API Key and generate or input an image prompt'));
      return;
    }
    setError(null);
    setLoading(true);
    abortRequestedRef.current = false;
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;
    try {
      const singlePrompt = getPromptList(1)[0] || imagePrompt.trim();
      const url = await requestImageGenerate({
        apiKey,
        provider,
        model: imageModel,
        prompt: singlePrompt,
        size,
        baseImages:
          provider === 'qwen' || provider === 'openrouter' ? undefined : baseImages.length > 0 ? baseImages : undefined,
      }, signal);
      if (url) {
        setGeneratedImages((prev) => [...prev, url]);
        addToImageHistory(imagePrompt, [], [], [url]);
      }
    } catch (e) {
      if (abortRequestedRef.current || (e instanceof Error && e.name === 'AbortError')) return;
      setError(e instanceof Error ? e.message : t('生图失败', 'Image generation failed'));
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const generateFullSet = async () => {
    const list = getPromptList();
    if (!apiKey || list.length === 0) {
      setError(t('请先点击「生成全套组图 Prompt（5 主图 + 5 详情）」生成 10 条提示词，或在上方文本框内输入多条提示词（用 --- 分隔）', 'Please click "Generate Full Set Prompts (5 Main + 5 Detail)" first, or enter multiple prompts separated by --- in the text box above'));
      return;
    }
    setError(null);
    setLoading(true);
    abortRequestedRef.current = false;
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;
    setMainGeneratedImages([]);
    setDetailGeneratedImages([]);
    const total = Math.min(list.length, 10);
    const mainUrls: string[] = [];
    const detailUrls: string[] = [];

    for (let i = 0; i < total; i++) {
      if (abortRequestedRef.current) break;
      const label = i < 5 ? t(`主图 ${i + 1}`, `Main ${i + 1}`) : t(`详情图 ${i - 4}`, `Detail ${i - 4}`);
      setProgress({ current: i + 1, total, label });
      try {
        const url = await requestImageGenerate({
          apiKey,
          provider,
          model: imageModel,
          prompt: list[i],
          size,
          baseImages:
            provider === 'qwen' || provider === 'openrouter' ? undefined : baseImages.length > 0 ? baseImages : undefined,
        }, signal);
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
        if (abortRequestedRef.current || (e instanceof Error && e.name === 'AbortError')) break;
        setProgress(null);
        setError(e instanceof Error ? e.message : t(`第 ${i + 1} 张生成失败`, `Image ${i + 1} generation failed`));
        setLoading(false);
        abortControllerRef.current = null;
        return;
      }
    }
    setProgress(null);
    setLoading(false);
    abortControllerRef.current = null;
    if (!abortRequestedRef.current && (mainUrls.length > 0 || detailUrls.length > 0)) {
      addToImageHistory(imagePrompt, mainUrls, detailUrls, []);
    }
  };

  const generateByCount = async () => {
    const count = Math.min(20, Math.max(2, generateCount));
    const list = getPromptListForCount(count);
    if (!apiKey || list.length === 0) {
      setError(t('请填写 API Key 并在上方输入至少一条生图提示词', 'Please enter API Key and at least one image prompt above'));
      return;
    }
    setError(null);
    setLoading(true);
    abortRequestedRef.current = false;
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;
    setCountGeneratedImages([]);
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      if (abortRequestedRef.current) break;
      setProgress({ current: i + 1, total: count, label: t(`第 ${i + 1} 张`, `Image ${i + 1}`) });
      try {
        const url = await requestImageGenerate({
          apiKey,
          provider,
          model: imageModel,
          prompt: list[i],
          size,
          baseImages:
            provider === 'qwen' || provider === 'openrouter' ? undefined : baseImages.length > 0 ? baseImages : undefined,
        }, signal);
        if (url) {
          urls.push(url);
          setCountGeneratedImages((prev) => [...prev, url]);
        }
      } catch (e) {
        if (abortRequestedRef.current || (e instanceof Error && e.name === 'AbortError')) break;
        setProgress(null);
        setError(e instanceof Error ? e.message : t(`第 ${i + 1} 张生成失败`, `Image ${i + 1} generation failed`));
        setLoading(false);
        abortControllerRef.current = null;
        return;
      }
    }
    setProgress(null);
    setLoading(false);
    abortControllerRef.current = null;
    if (!abortRequestedRef.current && urls.length > 0) {
      addToImageHistory(imagePrompt, [], [], urls);
    }
  };

  const removeGenerated = (index: number) => {
    setGeneratedImages((prev) => prev.filter((_, i) => i !== index));
    if (selectedGenerated === index) setSelectedGenerated(null);
    else if (selectedGenerated !== null && selectedGenerated > index) setSelectedGenerated(selectedGenerated - 1);
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 relative">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-[1400px] mx-auto">
        <div className="space-y-4">
          {/* 精修放左侧顶部：避免排在整页最底部导致「找不到」 */}
          <div
            id="ecom-image-refine-panel"
            className="rounded-lg border-4 border-amber-500 dark:border-amber-500 bg-amber-100 dark:bg-amber-950/50 p-4 space-y-3 shadow-md ring-2 ring-amber-300/80 dark:ring-amber-600/50"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Wand2 className="w-6 h-6 shrink-0 text-amber-700 dark:text-amber-300" />
              <span className="text-base font-bold text-amber-950 dark:text-amber-50">{t('图片精修', 'Image Refine')}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-600 text-white font-medium">{t('看这里', 'Look here')}</span>
            </div>
            <p className="text-sm text-amber-950 dark:text-amber-100 leading-relaxed">
              {locale === 'en' ? (
                <>Use <strong>Gemini</strong> to optimize <strong>existing images</strong> based on your instructions. You can <strong>upload local images</strong>, or click &quot;Refine&quot; on generated images below.</>
              ) : (
                <>用 <strong>Gemini</strong> 在<strong>已有图片</strong>上按你的文字说明做优化。可先<strong>上传本地图片</strong>，或到下方「生成的图片」里点「精修」选图。</>
              )}
            </p>
            <input
              ref={refineFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = async () => {
                  const u = String(reader.result || '');
                  if (u.startsWith('data:image/')) {
                    const compressed = await compressImageDataUrl(u);
                    setRefineSourceUrl(compressed);
                  }
                };
                reader.readAsDataURL(f);
                e.target.value = '';
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{t('当前原图：', 'Source image:')}</span>
              {refineSourceUrl ? (
                <>
                  <div className="w-14 h-14 rounded border-2 border-amber-500 overflow-hidden bg-white dark:bg-slate-800 shrink-0">
                    <img src={refineSourceUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  <button
                    type="button"
                    className="text-xs px-3 py-1.5 rounded-lg border-2 border-slate-400 font-medium hover:bg-white dark:hover:bg-slate-800"
                    onClick={() => setRefineSourceUrl(null)}
                  >
                    {t('清除', 'Clear')}
                  </button>
                </>
              ) : (
                <span className="text-xs text-amber-900 dark:text-amber-200">{t('未选择', 'None selected')}</span>
              )}
              <button
                type="button"
                disabled={refineLoading}
                onClick={() => refineFileInputRef.current?.click()}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50"
              >
                {t('上传原图（可直接精修）', 'Upload source image')}
              </button>
            </div>
            <textarea
              value={refineInstruction}
              onChange={(e) => setRefineInstruction(e.target.value)}
              rows={3}
              disabled={refineLoading}
              placeholder={t('例如：整体提亮；去掉右下角杂物。若改中文卖点字，可写明要逐字替换的完整句子（仍可能偶发错字，见下）', 'E.g., brighten overall; remove clutter in bottom-right corner. For text changes, specify exact replacement text (occasional character errors may occur).')}
              className="w-full text-sm rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-60"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('说明：图中文字由 AI「绘制」，常出现形近错字（如盈→缦），属模型能力限制，不是本工具传错字。重要文案建议在美图/PS 中叠字，或主图用英文短语。', 'Note: Text in images is "drawn" by AI and may contain similar-looking character errors. This is a model limitation, not a tool error. For important text, use image editing software to overlay text, or use short English phrases.')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={refineLoading || !refineSourceUrl || !refineInstruction.trim()}
                onClick={() => void runImageRefine()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none"
              >
                {refineLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {refineLoading ? t('精修中…', 'Refining…') : t('开始精修', 'Start Refine')}
              </button>
              {provider !== 'gemini' && provider !== 'detaler' && (
                <span className="text-xs text-red-600 dark:text-red-400">{t('请先在顶部配置栏切换为 Gemini 或 Detaler', 'Please switch to Gemini or Detaler in the top settings bar')}</span>
              )}
            </div>
          </div>

          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">{t('产品信息 / 生图提示词', 'Product Info / Image Prompt')}</h2>
            <textarea
              value={productContext}
              onChange={(e) => setProductContext(e.target.value)}
              placeholder={t('输入产品标题、卖点、材质、场景等，用于自动生成绘图 Prompt', 'Enter product title, features, materials, scenes, etc. to auto-generate image prompts')}
              rows={4}
              className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y mb-3"
            />
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-sm text-slate-600 dark:text-slate-400">{t('Prompt 语言', 'Prompt Language')}</span>
              <select
                value={promptLanguage}
                onChange={(e) => setPromptLanguage(e.target.value as 'en' | 'zh')}
                className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
              >
                <option value="en">{t('英文', 'English')}</option>
                <option value="zh">{t('中文', 'Chinese')}</option>
              </select>
              <button
                type="button"
                onClick={() => generatePrompt(true)}
                disabled={loadingPrompt}
                className="px-4 py-2 text-sm rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 flex items-center gap-2"
              >
                {loadingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {t('根据产品信息生成全套组图 Prompt（5 主图 + 5 详情）', 'Generate Full Set Prompts (5 Main + 5 Detail)')}
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
                    {t('根据垫图生成 1 条 Prompt', 'Generate 1 Prompt from Reference')}
                  </button>
                  <button
                    type="button"
                    onClick={() => generatePromptFromImages(true)}
                    disabled={loadingPrompt}
                    className="px-4 py-2 text-sm rounded bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {loadingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {t('根据垫图生成全套 Prompt', 'Generate Full Set Prompts from Reference')}
                  </button>
                </>
              )}
            </div>

            {/* 同风格场景记忆：保存生成图+提示词，以后可一键应用生成其他产品的相似风格 */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('同风格场景记忆', 'Style Memory')}</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">{t(`本地保存（最多 ${MAX_STYLE_MEMORY} 条）`, `Saved locally (max ${MAX_STYLE_MEMORY})`)}</span>
              </div>
              {styleNotice && (
                <div className="mb-2 text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded px-2 py-1">
                  {styleNotice}
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                {t('生成出满意图片后，保存「提示词 + 生成图」为记忆；应用后会用相同风格参考图+提示词，方便给其他产品生成相似场景。', 'After generating satisfactory images, save the "prompt + generated images" as a memory. When applied, it uses the same style reference images and prompt to generate similar scenes for other products.')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={styleName}
                  onChange={(e) => setStyleName(e.target.value)}
                  placeholder={t('记忆名称（可选），例如：白底主图风格 / 厨房场景', 'Memory name (optional), e.g., White background style / Kitchen scene')}
                  className="flex-1 min-w-[220px] px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                />
                <button
                  type="button"
                  onClick={addStyleMemory}
                  className="px-4 py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600"
                >
                  {t('保存当前提示词+生成图风格', 'Save Current Prompt + Style')}
                </button>
              </div>
              {styleMemories.length > 0 ? (
                <ul className="mt-3 space-y-2 max-h-56 overflow-y-auto">
                  {styleMemories.map((m) => (
                    <li key={m.id} className="flex items-start gap-2 p-2 rounded border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40">
                      {m.styleImages && m.styleImages.length > 0 && (
                        <div className="flex-shrink-0 flex gap-0.5">
                          {m.styleImages.slice(0, 3).map((src, i) => (
                            <div key={i} className="w-10 h-10 rounded border border-slate-300 dark:border-slate-600 overflow-hidden bg-slate-100">
                              <img src={src} alt="" className="w-full h-full object-cover" />
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate" title={m.name}>{m.name}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{m.time}</span>
                          {m.styleImages && m.styleImages.length > 0 && (
                            <span className="text-xs text-sky-600 dark:text-sky-400">{t(`${m.styleImages.length} 张风格图`, `${m.styleImages.length} style images`)}</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2" title={m.promptText}>
                          {m.promptText}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => applyStyleMemory(m)}
                          className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {t('应用', 'Apply')}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeStyleMemory(m.id)}
                          className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          {t('删除', 'Delete')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">{t('暂无记忆。生成出满意的图后，点「保存当前提示词+生成图风格」，以后可一键应用同风格生成其他产品。', 'No memories yet. After generating satisfactory images, click "Save Current Prompt + Style" to apply the same style to other products later.')}</p>
              )}
            </div>
            <textarea
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder={t('生图提示词（可手动编辑）。生成全套时请用 --- 分隔多条，前 5 条为主图、后 5 条为详情图', 'Image prompts (editable). For full set, separate with --- ; first 5 = main, next 5 = detail')}
              rows={6}
              className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y"
            />
          </section>

          <section ref={baseSectionRef} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('产品主图（垫图）', 'Product Images (Reference)')}</h2>
              {baseImages.length > 0 && (
                <span className="text-sm font-medium text-sky-600 dark:text-sky-400">
                  {t(`已添加 ${baseImages.length} 张`, `${baseImages.length} added`)}{baseImages.length >= 8 ? t('（已满）', ' (full)') : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              {locale === 'en' ? (
                <>
                  When using <span className="font-semibold">Gemini</span>, reference images here will be combined with text prompts above to generate new images.
                  {baseImages.length >= 2 ? (
                    <> Multiple reference images added. AI will <strong>reference all images</strong> and <strong>compare, select, or blend</strong> per your prompt (e.g., keep composition from first, colors from second).</>
                  ) : (
                    <> When multiple images are uploaded, AI will reference all and adjust per your prompt.</>
                  )}
                  {' '}DALL·E only supports text prompts without reference images.
                </>
              ) : (
                <>
                  选择服务商为 <span className="font-semibold">Gemini</span> 时，会结合这里的垫图与上方文字提示生成新图。
                  {baseImages.length >= 2 ? (
                    <> 当前已添加多张垫图，AI 会<strong>同时参考所有图片</strong>，并按你在生图提示词中的要求进行<strong>对比、取舍或融合</strong>（如：保留第一张构图、第二张色调等）。</>
                  ) : (
                    <> 上传多张时，AI 会参考全部垫图并按你的提示词做对比与调整。</>
                  )}
                  若使用 DALL·E，仅支持文字提示，不参考垫图。
                </>
              )}
            </p>
            {provider === 'openrouter' && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                {t('OpenRouter 生图当前仅支持文生图，垫图功能已禁用。', 'OpenRouter currently supports text-to-image only, so references are disabled.')}
              </p>
            )}
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
                disabled={baseImages.length >= 8 || provider === 'openrouter'}
                className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> {t('添加主图', 'Add Images')}
              </button>
              {baseImages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBaseImages([])}
                  className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t('清空全部', 'Clear All')}
                </button>
              )}
            </div>
            {baseImages.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 py-8 px-4 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{t('暂无垫图', 'No reference images')}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{t('点击上方「添加主图」上传，已添加的图片会显示在下方', 'Click "Add Images" above to upload. Added images will appear below.')}</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {baseImages.map((src, i) => (
                  <div key={i} className="relative group">
                    <div
                      className="w-24 h-24 rounded-lg border-2 border-slate-300 dark:border-slate-600 overflow-hidden bg-slate-100 dark:bg-slate-800 cursor-pointer hover:opacity-90"
                      onClick={() => setZoomImageUrl(src)}
                      title={t('点击放大查看', 'Click to zoom')}
                    >
                      <img src={src} alt={t(`垫图 ${i + 1}`, `Reference ${i + 1}`)} className="w-full h-full object-cover" />
                    </div>
                    <span className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-xs font-medium text-white bg-black/60 rounded-b-md">
                      {t(`第 ${i + 1} 张`, `#${i + 1}`)}{baseImages.length >= 2 ? t('（均参与生图）', ' (all used)') : i === 0 ? t('（生图使用）', ' (used)') : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => setBaseImages((p) => p.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-90 hover:opacity-100 shadow"
                      title={t('删除', 'Delete')}
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
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('批量生成：待处理图片', 'Batch Generate: Source Images')}</h2>
              {batchSourceImages.length > 0 && (
                <span className="text-sm font-medium text-sky-600 dark:text-sky-400">
                  {t(`已添加 ${batchSourceImages.length} 张`, `${batchSourceImages.length} added`)}{batchSourceImages.length >= MAX_BATCH_SOURCES ? t('（已满）', ' (full)') : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              {locale === 'en' ? (
                <>The prompt and <strong>Product Images (Reference)</strong> above remain unchanged. Each image below will be processed individually: same prompt + reference images + current image → one new image. Ideal for applying a unified style across multiple images.</>
              ) : (
                <>提示词与上方<strong>产品主图（垫图）</strong>保持不变，对下面每张图分别调用生图：用同一提示词 + 垫图 + 当前这张图，生成一张新图。适合对多张图做统一风格/统一处理。</>
              )}
            </p>
            {provider === 'openrouter' && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                {t('OpenRouter 不支持批量+垫图参考，建议切换 Gemini 使用该功能。', 'OpenRouter does not support batch with references. Switch to Gemini for this feature.')}
              </p>
            )}
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
                <Plus className="w-4 h-4" /> {t('添加待处理图片', 'Add Source Images')}
              </button>
              {batchSourceImages.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setBatchSourceImages([]); setBatchGeneratedImages([]); }}
                  className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t('清空', 'Clear')}
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
                  {t('开始批量生成', 'Start Batch Generate')}
                </button>
              )}
            </div>
            {batchSourceImages.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 py-6 px-4 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('暂无待处理图片', 'No source images')}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('添加多张图片后，将按同一提示词和垫图逐张生成新图', 'After adding images, each will be processed with the same prompt and reference images.')}</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                {batchSourceImages.map((src, i) => (
                  <div key={i} className="relative flex-shrink-0">
                    <div className="w-16 h-16 rounded border border-slate-300 dark:border-slate-600 overflow-hidden bg-slate-100 dark:bg-slate-800">
                      <img src={src} alt={t(`待处理 ${i + 1}`, `Source ${i + 1}`)} className="w-full h-full object-cover" />
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
                      title={t('删除', 'Delete')}
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
              <option value="2048x2048">2048×2048</option>
              <option value="1464x400">1464×400</option>
              <option value="600x450">600×450</option>
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
              {t('生成 1 张', 'Generate 1')}
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
                  {progress.current}/{progress.total} ({progress.label})
                </>
              ) : (
                <>{t('生成全套 10 张（5 主图 + 5 详情）', 'Generate Full Set (5 Main + 5 Detail)')}</>
              )}
            </button>
            <span className="text-slate-400 dark:text-slate-500">|</span>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              {t('生成数量', 'Count')}
              <input
                type="number"
                min={2}
                max={20}
                value={generateCount}
                onChange={(e) => setGenerateCount(Math.min(20, Math.max(2, parseInt(String(e.target.value), 10) || 2)))}
                className="w-14 px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
              />
              {t('张', '')}
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
                <>{t('按数量生成', 'Generate by Count')}</>
              )}
            </button>
          </div>
          {/* 生成过程中可随时点击停止 */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('生成过程中可随时点击：', 'Click anytime during generation:')}</span>
            <button
              type="button"
              onClick={stopGenerating}
              disabled={!loading}
              title={loading ? t('点击停止当前生成', 'Click to stop current generation') : t('生成进行中时可点击停止', 'Click to stop when generating')}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 border-2 border-red-500"
            >
              <Square className="w-4 h-4" /> {t('停止生成', 'Stop')}
            </button>
          </div>
          {loading && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
              <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400 mb-2">
                <span>{progress ? t(`正在生成第 ${progress.current}/${progress.total} 张`, `Generating ${progress.current}/${progress.total}`) : t('正在生成 1 张…', 'Generating 1 image…')}</span>
                <span className="font-mono tabular-nums text-sky-600 dark:text-sky-400">
                  {elapsedSec >= 60 ? t(`${Math.floor(elapsedSec / 60)}分${elapsedSec % 60}秒`, `${Math.floor(elapsedSec / 60)}m${elapsedSec % 60}s`) : t(`${elapsedSec}秒`, `${elapsedSec}s`)}
                  {progress ? ` · ${progress.label}` : ''}
                </span>
              </div>
              {progress && (
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              )}
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
              {t('生成记录', 'History')} {imageHistory.length > 0 && <span className="text-slate-500 font-normal">({imageHistory.length})</span>}
            </span>
            {showImageHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showImageHistory && (
            <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-3 max-h-80 overflow-y-auto">
              {imageHistory.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">{t('暂无记录，生成单张或全套后会在此显示', 'No records yet. Records will appear here after generating images.')}</p>
              ) : (
                <>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={clearImageHistory}
                      className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {t('清空全部', 'Clear All')}
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {imageHistory.map((r) => {
                      const isFullSet = r.mainUrls.length > 0 || r.detailUrls.length > 0;
                      const thumb = r.mainUrls[0] || r.detailUrls[0] || r.singleUrls[0];
                      const typeLabel = isFullSet ? t('全套', 'Full Set') : t('单张', 'Single');
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
                                {t('恢复', 'Restore')}
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
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('生成的图片', 'Generated Images')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {locale === 'en' ? (
                <>Each image has a &quot;Refine&quot; button; the refine panel is in the <strong className="text-amber-700 dark:text-amber-300">amber card above</strong> (top of left column).</>
              ) : (
                <>每张图旁有「精修」；精修操作区在页面<strong className="text-amber-700 dark:text-amber-300">上方琥珀色卡片</strong>（左侧栏顶部）。</>
              )}
            </p>
          </div>

          {(mainGeneratedImages.length > 0 || detailGeneratedImages.length > 0) && (
            <>
              {mainGeneratedImages.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t(`产品主图（${mainGeneratedImages.length} 张）`, `Main Images (${mainGeneratedImages.length})`)}</h3>
                  <div className="flex flex-wrap gap-3">
                    {mainGeneratedImages.map((url, i) => (
                      <div key={`main-${i}`} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <img src={url} alt={t(`主图 ${i + 1}`, `Main ${i + 1}`)} className="w-36 h-36 object-cover cursor-pointer hover:opacity-90" onClick={() => setZoomImageUrl(url)} />
                        <div className="flex gap-1 p-1 bg-slate-50 dark:bg-slate-800">
                          <span className="text-xs text-slate-500 flex-1">{t(`主图 ${i + 1}`, `Main ${i + 1}`)}</span>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => downloadImage(url, t(`主图-${i + 1}.png`, `main-${i + 1}.png`))} title={t('保存', 'Save')}><Download className="w-3 h-3 inline" /> {t('保存', 'Save')}</button>
                          <button type="button" disabled={scenePromptLoading} className="text-xs px-2 py-0.5 rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50" onClick={() => extractScenePrompt(url)} title={t('提取场景提示词', 'Extract Scene Prompt')}><Sparkles className="w-3 h-3 inline" /> {t('场景', 'Scene')}</button>
                          <button type="button" disabled={refineLoading} className="text-xs px-2 py-0.5 rounded border border-amber-400 text-amber-900 dark:text-amber-200 dark:border-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50" onClick={() => setRefineSourceUrl(url)} title={t('设为精修原图', 'Set as refine source')}>{t('精修', 'Refine')}</button>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /></button>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => setMainGeneratedImages((p) => p.filter((_, j) => j !== i))}>{t('删除', 'Delete')}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detailGeneratedImages.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t(`产品详情图（${detailGeneratedImages.length} 张）`, `Detail Images (${detailGeneratedImages.length})`)}</h3>
                  <div className="flex flex-wrap gap-3">
                    {detailGeneratedImages.map((url, i) => (
                      <div key={`detail-${i}`} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <img src={url} alt={t(`详情图 ${i + 1}`, `Detail ${i + 1}`)} className="w-36 h-36 object-cover cursor-pointer hover:opacity-90" onClick={() => setZoomImageUrl(url)} />
                        <div className="flex gap-1 p-1 bg-slate-50 dark:bg-slate-800">
                          <span className="text-xs text-slate-500 flex-1">{t(`详情 ${i + 1}`, `Detail ${i + 1}`)}</span>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => downloadImage(url, t(`详情图-${i + 1}.png`, `detail-${i + 1}.png`))} title={t('保存', 'Save')}><Download className="w-3 h-3 inline" /> {t('保存', 'Save')}</button>
                          <button type="button" disabled={scenePromptLoading} className="text-xs px-2 py-0.5 rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50" onClick={() => extractScenePrompt(url)} title={t('提取场景提示词', 'Extract Scene Prompt')}><Sparkles className="w-3 h-3 inline" /> {t('场景', 'Scene')}</button>
                          <button type="button" disabled={refineLoading} className="text-xs px-2 py-0.5 rounded border border-amber-400 text-amber-900 dark:text-amber-200 dark:border-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50" onClick={() => setRefineSourceUrl(url)} title={t('设为精修原图', 'Set as refine source')}>{t('精修', 'Refine')}</button>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /></button>
                          <button type="button" className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => setDetailGeneratedImages((p) => p.filter((_, j) => j !== i))}>{t('删除', 'Delete')}</button>
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
              <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t('单张生成', 'Single Generation')}</h3>
              <div className="flex flex-wrap gap-3">
                {generatedImages.map((url, i) => (
                  <div key={i} className={selectedGenerated === i ? 'ring-2 ring-sky-500 rounded-lg' : 'rounded-lg'}>
                    <img src={url} alt="" className="w-40 h-40 object-cover rounded-lg cursor-pointer" onClick={() => setSelectedGenerated(i)} />
                    <div className="flex gap-1 mt-1">
                      <button type="button" className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => downloadImage(url, t(`单张-${i + 1}.png`, `single-${i + 1}.png`))} title={t('保存', 'Save')}><Download className="w-3 h-3 inline" /> {t('保存', 'Save')}</button>
                      <button type="button" disabled={scenePromptLoading} className="text-xs px-2 py-1 rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50" onClick={() => extractScenePrompt(url)} title={t('提取场景提示词', 'Extract Scene Prompt')}><Sparkles className="w-3 h-3 inline" /> {t('场景', 'Scene')}</button>
                      <button type="button" disabled={refineLoading} className="text-xs px-2 py-1 rounded border border-amber-400 text-amber-900 dark:text-amber-200 dark:border-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50" onClick={() => setRefineSourceUrl(url)} title={t('设为精修原图', 'Set as refine source')}>{t('精修', 'Refine')}</button>
                      <button type="button" className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /> {t('大图', 'Zoom')}</button>
                      <button type="button" className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => removeGenerated(i)}>{t('删除', 'Delete')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {countGeneratedImages.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t(`按数量生成（${countGeneratedImages.length} 张）`, `By Count (${countGeneratedImages.length})`)}</h3>
              <div className="flex flex-wrap gap-3">
                {countGeneratedImages.map((url, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <img src={url} alt={t(`第 ${i + 1} 张`, `#${i + 1}`)} className="w-36 h-36 object-cover cursor-pointer hover:opacity-90" onClick={() => setZoomImageUrl(url)} />
                    <div className="flex gap-1 p-1 bg-slate-50 dark:bg-slate-800">
                      <span className="text-xs text-slate-500 flex-1">{t(`第 ${i + 1} 张`, `#${i + 1}`)}</span>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => downloadImage(url, t(`按数量-${i + 1}.png`, `count-${i + 1}.png`))} title={t('保存', 'Save')}><Download className="w-3 h-3 inline" /> {t('保存', 'Save')}</button>
                      <button type="button" disabled={scenePromptLoading} className="text-xs px-2 py-0.5 rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50" onClick={() => extractScenePrompt(url)} title={t('提取场景提示词', 'Extract Scene Prompt')}><Sparkles className="w-3 h-3 inline" /> {t('场景', 'Scene')}</button>
                      <button type="button" disabled={refineLoading} className="text-xs px-2 py-0.5 rounded border border-amber-400 text-amber-900 dark:text-amber-200 dark:border-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50" onClick={() => setRefineSourceUrl(url)} title={t('设为精修原图', 'Set as refine source')}>{t('精修', 'Refine')}</button>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /></button>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => setCountGeneratedImages((p) => p.filter((_, j) => j !== i))}>{t('删除', 'Delete')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batchGeneratedImages.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t(`批量生成结果（${batchGeneratedImages.length} 张）`, `Batch Results (${batchGeneratedImages.length})`)}</h3>
              <div className="flex flex-wrap gap-3">
                {batchGeneratedImages.map((url, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <img src={url} alt={t(`批量 ${i + 1}`, `Batch ${i + 1}`)} className="w-36 h-36 object-cover cursor-pointer hover:opacity-90" onClick={() => setZoomImageUrl(url)} />
                    <div className="flex gap-1 p-1 bg-slate-50 dark:bg-slate-800">
                      <span className="text-xs text-slate-500 flex-1">{t(`批量 ${i + 1}`, `Batch ${i + 1}`)}</span>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => downloadImage(url, t(`批量-${i + 1}.png`, `batch-${i + 1}.png`))} title={t('保存', 'Save')}><Download className="w-3 h-3 inline" /> {t('保存', 'Save')}</button>
                      <button type="button" disabled={scenePromptLoading} className="text-xs px-2 py-0.5 rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50" onClick={() => extractScenePrompt(url)} title={t('提取场景提示词', 'Extract Scene Prompt')}><Sparkles className="w-3 h-3 inline" /> {t('场景', 'Scene')}</button>
                      <button type="button" disabled={refineLoading} className="text-xs px-2 py-0.5 rounded border border-amber-400 text-amber-900 dark:text-amber-200 dark:border-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50" onClick={() => setRefineSourceUrl(url)} title={t('设为精修原图', 'Set as refine source')}>{t('精修', 'Refine')}</button>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => setZoomImageUrl(url)}><ZoomIn className="w-3 h-3 inline" /></button>
                      <button type="button" className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50" onClick={() => setBatchGeneratedImages((p) => p.filter((_, j) => j !== i))}>{t('删除', 'Delete')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mainGeneratedImages.length === 0 && detailGeneratedImages.length === 0 && generatedImages.length === 0 && countGeneratedImages.length === 0 && batchGeneratedImages.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">{t('生成后将显示于此（可生成 1 张、按数量、批量或全套 10 张）', 'Generated images will appear here (single, by count, batch, or full set of 10)')}</p>
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
              className="absolute top-4 right-14 z-10 w-10 h-10 rounded-full bg-white/90 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-white shadow"
              onClick={() => setZoomImageUrl(null)}
              aria-label={t('关闭', 'Close')}
            >
              <X className="w-5 h-5" />
            </button>
            <button
              type="button"
              disabled={refineLoading}
              className="absolute top-4 left-4 z-10 px-4 py-2 rounded-full bg-amber-500 text-white flex items-center gap-2 hover:bg-amber-600 shadow disabled:opacity-60"
              onClick={(e) => {
                e.stopPropagation();
                setRefineSourceUrl(zoomImageUrl);
                setZoomImageUrl(null);
              }}
              aria-label={t('带入精修', 'Refine this')}
            >
              <Wand2 className="w-5 h-5" /> {t('带入精修', 'Refine this')}
            </button>
            <button
              type="button"
              className="absolute top-4 right-4 z-10 px-4 py-2 rounded-full bg-sky-500 text-white flex items-center gap-2 hover:bg-sky-600 shadow"
              onClick={(e) => { e.stopPropagation(); downloadImage(zoomImageUrl, t('生成的图片.png', 'generated.png')); }}
              aria-label={t('保存', 'Save')}
            >
              <Download className="w-5 h-5" /> {t('保存', 'Save')}
            </button>
            <button
              type="button"
              className="absolute top-4 right-44 z-10 px-4 py-2 rounded-full bg-indigo-500 text-white flex items-center gap-2 hover:bg-indigo-600 shadow disabled:opacity-60"
              disabled={scenePromptLoading}
              onClick={(e) => { e.stopPropagation(); extractScenePrompt(zoomImageUrl); }}
              aria-label={t('提取场景提示词', 'Extract Scene Prompt')}
            >
              <Sparkles className="w-5 h-5" /> {t('提取场景提示词', 'Extract Scene Prompt')}
            </button>
            <img
              src={zoomImageUrl}
              alt={t('放大预览', 'Preview')}
              className="max-w-full max-h-[90vh] w-auto h-auto object-contain rounded shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </div>
  );
}
