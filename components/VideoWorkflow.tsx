'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Image as ImageIcon, Video, Upload, Plus, Trash2, Square, Film, GripVertical, ChevronRight, Download, ArrowLeft } from 'lucide-react';
import { compressImages } from '@/lib/compress-image';
import { useI18n } from '@/lib/i18n';

type VideoWorkflowProps = { apiKey: string; videoApiKey: string; videoModel: string };

type TabMode = 'image2video' | 'text2video' | 'template';

type AnalyzedScene = {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  description: string;
  cameraMove: string;
  needsProductImage: boolean;
  productImageDataUrl?: string;
  /** 从原视频提取的关键帧 */
  frameDataUrl?: string;
  /** 经过 AI 产品替换后的帧 */
  editedFrameDataUrl?: string;
  background?: string;
  lighting?: string;
  colorGrading?: string;
  composition?: string;
  textOverlay?: string | null;
  transition?: string;
  props?: string;
  audioMood?: string;
  subjectAction?: string;
};

type StoryboardData = {
  scenes: AnalyzedScene[];
  totalDurationSec: number;
  style: string;
  summary?: string;
  detectedLanguage?: string;
};

type ScenePollStatus = { index: number; status: string; error?: string; streamUrl?: string };

type TemplateStep = 'upload' | 'edit' | 'generate';

/** 产品垫图最多张数：与 Veo 3.1 多图参考上限一致 */
const MAX_PRODUCT_IMAGES = 3;

/** 整段流程（提交 + 多次轮询）上限，略大于服务端任务有效期 */
const CLIENT_VIDEO_TIMEOUT_MS = 340000;

const POLL_INTERVAL_MS = 8000;

function isAbortLike(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'AbortError') return true;
  return /aborted|AbortError|The user aborted/i.test(e.message);
}

export function VideoWorkflow({ apiKey, videoApiKey, videoModel }: VideoWorkflowProps) {
  const { t } = useI18n();
  const effectiveKey = videoModel?.startsWith('veo-') ? apiKey : videoApiKey;
  const isVeo31 = videoModel?.includes('veo-3.1') || videoModel?.includes('veo-3');
  const [mode, setMode] = useState<TabMode>('image2video');
  const [productImages, setProductImages] = useState<string[]>([]);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [textScript, setTextScript] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitSec, setWaitSec] = useState(0);
  /** Veo：竖屏 9:16 适合手机电商（与提示词里「竖屏」一致） */
  const [veoAspectRatio, setVeoAspectRatio] = useState<'16:9' | '9:16'>('9:16');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoAbortRef = useRef<AbortController | null>(null);

  // --- 模板视频 state ---
  const [templateStep, setTemplateStep] = useState<TemplateStep>('upload');
  const [refVideoDataUrl, setRefVideoDataUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [storyboard, setStoryboard] = useState<StoryboardData | null>(null);
  const [storyboardJobId, setStoryboardJobId] = useState<string | null>(null);
  const [sbSceneStatuses, setSbSceneStatuses] = useState<ScenePollStatus[]>([]);
  const [sbStatus, setSbStatus] = useState<string>('');
  const [sbFinalUrl, setSbFinalUrl] = useState<string | null>(null);
  const [sbError, setSbError] = useState<string | null>(null);
  const refVideoInputRef = useRef<HTMLInputElement>(null);
  const sceneImgInputRef = useRef<HTMLInputElement>(null);
  const [editingSceneIdx, setEditingSceneIdx] = useState<number | null>(null);
  const [globalProductImg, setGlobalProductImg] = useState<string | null>(null);
  const [rewritingScenes, setRewritingScenes] = useState(false);
  const [replacingProduct, setReplacingProduct] = useState(false);
  const [replaceProgress, setReplaceProgress] = useState('');
  const globalImgInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading) {
      setWaitSec(0);
      return;
    }
    const t0 = Date.now();
    setWaitSec(0);
    const id = setInterval(() => setWaitSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    return () => {
      videoAbortRef.current?.abort();
    };
  }, []);

  const readApiJson = useCallback(
    async (res: Response): Promise<Record<string, unknown>> => {
      const text = await res.text();
      if (!text) return {};
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(t(`服务器返回非 JSON（HTTP ${res.status}）`, `Server returned non-JSON (HTTP ${res.status})`));
      }
    },
    [t]
  );

  const pollUntilVideoReady = useCallback(
    async (jobId: string, signal: AbortSignal) => {
      const deadline = Date.now() + CLIENT_VIDEO_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const res = await fetch(`/api/video/job/${encodeURIComponent(jobId)}`, { signal });
        const data = await readApiJson(res);
        const status = typeof data.status === 'string' ? data.status : '';
        if (status === 'done') {
          const u = (typeof data.videoUrl === 'string' && data.videoUrl)
            ? data.videoUrl
            : (typeof data.url === 'string' ? data.url : '');
          if (u) return u;
          throw new Error(t('已完成但未返回视频地址', 'Completed but no video URL was returned'));
        }
        if (status === 'error') {
          throw new Error(typeof data.error === 'string' ? data.error : t('视频生成失败', 'Video generation failed'));
        }
        if (!res.ok) {
          throw new Error(
            typeof data.error === 'string' ? data.error : t(`轮询失败 (${res.status})`, `Polling failed (${res.status})`)
          );
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      throw new Error(t('等待视频超时，请重试', 'Timed out waiting for video; please try again'));
    },
    [readApiJson, t]
  );

  /** 先 POST 提交任务（短连接），再轮询 GET，避免 Zeabur 等网关长连接中断 */
  const runVideoJob = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      videoAbortRef.current?.abort();
      const ctrl = new AbortController();
      videoAbortRef.current = ctrl;
      const killTimer = setTimeout(() => ctrl.abort(), CLIENT_VIDEO_TIMEOUT_MS);
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const data = await readApiJson(res);
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : t(`请求失败 (${res.status})`, `Request failed (${res.status})`));
        }
        const jobId = typeof data.jobId === 'string' ? data.jobId : '';
        if (!jobId) {
          throw new Error(t('服务器未返回任务 ID，请刷新页面后重试', 'Server did not return a job ID; refresh and try again'));
        }
        return await pollUntilVideoReady(jobId, ctrl.signal);
      } finally {
        clearTimeout(killTimer);
      }
    },
    [pollUntilVideoReady, readApiJson, t]
  );

  const onImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const room = MAX_PRODUCT_IMAGES - productImages.length;
    if (room <= 0) {
      e.target.value = '';
      return;
    }
    const count = Math.min(files.length, room);
    const readPromises: Promise<string>[] = [];
    for (let i = 0; i < count; i++) {
      readPromises.push(
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => resolve('');
          reader.readAsDataURL(files[i]);
        })
      );
    }
    const raw = (await Promise.all(readPromises)).filter(Boolean);
    const compressed = await compressImages(raw);
    setProductImages((prev) => [...prev, ...compressed].slice(0, MAX_PRODUCT_IMAGES));
    e.target.value = '';
  };

  const runImage2Video = async () => {
    if (!effectiveKey || productImages.length === 0) {
      setError(
        videoModel?.startsWith('veo-')
          ? t('请填写 Gemini API Key（配置栏）并至少上传一张产品图', 'Enter your Gemini API Key (settings) and upload at least one product image')
          : t('请填写视频 API Key（Runway）并至少上传一张产品图', 'Enter your video API Key (Runway) and upload at least one product image')
      );
      return;
    }
    setError(null);
    setLoading(true);
    setGeneratedVideoUrl(null);
    try {
      const url = await runVideoJob('/api/video/image2video', {
        apiKey: effectiveKey,
        model: videoModel,
        imageDataUrls: productImages,
        prompt: videoPrompt || undefined,
        ...(videoModel.startsWith('veo-') ? { aspectRatio: veoAspectRatio } : {}),
      });
      setGeneratedVideoUrl(url || null);
    } catch (e) {
      if (isAbortLike(e)) return;
      setError(e instanceof Error ? e.message : t('图生视频失败', 'Image-to-video failed'));
    } finally {
      setLoading(false);
    }
  };

  const runText2Video = async () => {
    if (!effectiveKey || !textScript.trim()) {
      setError(
        videoModel?.startsWith('veo-')
          ? t('请填写 Gemini API Key（配置栏）和视频描述/脚本', 'Enter your Gemini API Key (settings) and a video description/script')
          : t('请填写视频 API Key 和视频描述/脚本', 'Enter your video API Key and a video description/script')
      );
      return;
    }
    setError(null);
    setLoading(true);
    setGeneratedVideoUrl(null);
    try {
      const url = await runVideoJob('/api/video/text2video', {
        apiKey: effectiveKey,
        model: videoModel,
        prompt: textScript,
        ...(videoModel.startsWith('veo-') ? { aspectRatio: veoAspectRatio } : {}),
      });
      setGeneratedVideoUrl(url || null);
    } catch (e) {
      if (isAbortLike(e)) return;
      setError(e instanceof Error ? e.message : t('文生视频失败', 'Text-to-video failed'));
    } finally {
      setLoading(false);
    }
  };

  const stopGeneration = useCallback(() => {
    videoAbortRef.current?.abort();
    videoAbortRef.current = null;
    setLoading(false);
    setError(t('已停止生成', 'Generation stopped'));
  }, [t]);

  // --- 模板视频方法 ---
  const onRefVideoSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        setError(t('参考视频不能超过 20MB，请压缩或裁剪后重试', 'Reference video must be under 20MB; compress or trim and try again'));
        e.target.value = '';
        return;
      }
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });
      setRefVideoDataUrl(dataUrl);
      setError(null);
      e.target.value = '';
    },
    [t]
  );

  const analyzeRefVideo = useCallback(async () => {
    if (!refVideoDataUrl || !apiKey?.trim()) {
      setError(t('请先上传参考视频并确保 Gemini API Key 已填写', 'Upload a reference video and enter your Gemini API Key'));
      return;
    }
    setAnalyzing(true);
    setError(null);
    setSbError(null);
    try {
      const res = await fetch('/api/video/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), videoDataUrl: refVideoDataUrl, language: 'auto' }),
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : t(`分析失败 (${res.status})`, `Analysis failed (${res.status})`));
      const scenes = Array.isArray(data.scenes) ? (data.scenes as AnalyzedScene[]) : [];
      if (scenes.length === 0) throw new Error(t('未识别到分镜场景，请换一个更清晰的参考视频', 'No scenes detected; try a clearer reference video'));
      const detectedLang = typeof data.detectedLanguage === 'string' ? data.detectedLanguage : 'auto';
      setStoryboard({
        scenes: scenes.map((s, i) => ({ ...s, index: i + 1 })),
        totalDurationSec: typeof data.totalDurationSec === 'number' ? data.totalDurationSec : scenes.reduce((a, s) => a + (s.durationSec || 6), 0),
        style: typeof data.style === 'string' ? data.style : '',
        summary: typeof data.summary === 'string' ? data.summary : undefined,
        detectedLanguage: detectedLang,
      });
      setTemplateStep('edit');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('视频分析失败', 'Video analysis failed'));
    } finally {
      setAnalyzing(false);
    }
  }, [refVideoDataUrl, apiKey, readApiJson, t]);

  const updateSceneDescription = useCallback((idx: number, desc: string) => {
    setStoryboard((prev) => {
      if (!prev) return prev;
      const scenes = [...prev.scenes];
      scenes[idx] = { ...scenes[idx], description: desc };
      return { ...prev, scenes };
    });
  }, []);

  const removeScene = useCallback((idx: number) => {
    setStoryboard((prev) => {
      if (!prev) return prev;
      const scenes = prev.scenes.filter((_, i) => i !== idx).map((s, i) => ({ ...s, index: i + 1 }));
      return { ...prev, scenes, totalDurationSec: scenes.reduce((a, s) => a + (s.durationSec || 6), 0) };
    });
  }, []);

  const setSceneProductImage = useCallback(async (idx: number, file: File) => {
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
    const [compressed] = await compressImages([dataUrl]);
    setStoryboard((prev) => {
      if (!prev) return prev;
      const scenes = [...prev.scenes];
      scenes[idx] = { ...scenes[idx], productImageDataUrl: compressed };
      return { ...prev, scenes };
    });
  }, []);

  const startStoryboardGeneration = useCallback(async () => {
    if (!storyboard || !apiKey?.trim()) return;
    setSbError(null);
    setSbFinalUrl(null);
    setSbStatus('submitting');
    setSbSceneStatuses(storyboard.scenes.map((s) => ({ index: s.index, status: 'pending' })));
    setTemplateStep('generate');

    try {
      const scenes = storyboard.scenes.map((s) => ({
        description: s.description,
        durationSec: s.durationSec || 6,
        cameraMove: s.cameraMove,
        needsProductImage: s.needsProductImage,
        productImageDataUrl: s.productImageDataUrl,
        editedFrameDataUrl: s.editedFrameDataUrl,
        background: s.background,
        lighting: s.lighting,
        colorGrading: s.colorGrading,
        composition: s.composition,
        textOverlay: s.textOverlay,
        transition: s.transition,
        props: s.props,
        audioMood: s.audioMood,
        subjectAction: s.subjectAction,
      }));
      const res = await fetch('/api/video/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          model: videoModel || 'veo-2.0-generate-001',
          scenes,
          aspectRatio: veoAspectRatio,
          keepOriginalLanguage: storyboard.detectedLanguage !== 'en',
        }),
      });
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : t(`提交失败 (${res.status})`, `Submit failed (${res.status})`));
      const jobId = typeof data.jobId === 'string' ? data.jobId : '';
      if (!jobId) throw new Error(t('未返回任务 ID', 'No job ID returned'));
      setStoryboardJobId(jobId);
      setSbStatus('generating');
    } catch (e) {
      setSbError(e instanceof Error ? e.message : t('提交分镜任务失败', 'Failed to submit storyboard job'));
      setSbStatus('error');
    }
  }, [storyboard, apiKey, videoModel, veoAspectRatio, readApiJson, t]);

  useEffect(() => {
    if (!storyboardJobId || sbStatus === 'done' || sbStatus === 'error') return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`/api/video/storyboard/${encodeURIComponent(storyboardJobId)}`);
          const data = await readApiJson(res);
          if (cancelled) return;
          if (!res.ok) {
            if (res.status === 404) {
              setSbError(t('任务不存在', 'Job not found'));
              setSbStatus('error');
              return;
            }
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }
          const st = typeof data.status === 'string' ? data.status : '';
          const scenesArr = Array.isArray(data.scenes) ? (data.scenes as ScenePollStatus[]) : [];
          setSbSceneStatuses(scenesArr);
          if (st === 'done') {
            setSbFinalUrl(typeof data.finalVideoUrl === 'string' ? data.finalVideoUrl : null);
            setSbStatus('done');
            return;
          }
          if (st === 'error') {
            setSbError(typeof data.error === 'string' ? data.error : t('生成失败', 'Generation failed'));
            setSbStatus('error');
            return;
          }
          setSbStatus(st);
        } catch {
          /* network blip, retry */
        }
        await new Promise((r) => setTimeout(r, 8000));
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [storyboardJobId, sbStatus, readApiJson, t]);

  const templateStepLabels = [t('上传参考', 'Upload Reference'), t('编辑分镜', 'Edit Storyboard'), t('批量生成', 'Batch Generate')];

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('选择 ', 'When using ')}
          <strong>Gemini Veo 2 / Veo 3.1</strong>
          {t(' 时使用配置栏的 ', ', use the ')}
          <strong>Gemini API Key</strong>
          {t('；选择 Runway / 可灵 / Luma 时请填写「视频 API Key」。', '; for Runway / Kling / Luma, fill in the “video API Key”.')}
        </p>
        {videoModel.startsWith('veo-') && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-slate-600 dark:text-slate-400">{t('Veo 画幅', 'Veo aspect ratio')}</label>
            <select
              value={veoAspectRatio}
              onChange={(e) => setVeoAspectRatio(e.target.value as '16:9' | '9:16')}
              disabled={loading}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
            >
              <option value="9:16">{t('竖屏 9:16（手机电商）', 'Portrait 9:16 (mobile commerce)')}</option>
              <option value="16:9">{t('横屏 16:9', 'Landscape 16:9')}</option>
            </select>
          </div>
        )}
        {loading && (
          <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            {t('已等待 ', 'Waited ')}
            <strong>{waitSec}</strong>
            {t(' 秒。视频采用', 's. Video uses ')}
            <strong>{t('分段轮询', 'segmented polling')}</strong>
            {t(
              `（每 ${POLL_INTERVAL_MS / 1000} 秒查询一次），适合线上部署；通常 2～6 分钟完成。超过约 5～6 分钟无结果会提示超时重试。`,
              ` (every ${POLL_INTERVAL_MS / 1000}s), suitable for production; usually finishes in 2–6 minutes. After ~5–6 minutes with no result, you will be prompted to retry.`
            )}
          </p>
        )}
        <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
          <button
            type="button"
            onClick={() => setMode('image2video')}
            className={`px-4 py-2 rounded-t text-sm font-medium ${mode === 'image2video' ? 'bg-sky-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
          >
            <ImageIcon className="w-4 h-4 inline mr-2" /> {t('图生视频', 'Image to Video')}
          </button>
          <button
            type="button"
            onClick={() => setMode('text2video')}
            className={`px-4 py-2 rounded-t text-sm font-medium ${mode === 'text2video' ? 'bg-sky-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
          >
            <Video className="w-4 h-4 inline mr-2" /> {t('文生视频', 'Text to Video')}
          </button>
          <button
            type="button"
            onClick={() => setMode('template')}
            className={`px-4 py-2 rounded-t text-sm font-medium ${mode === 'template' ? 'bg-purple-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
          >
            <Film className="w-4 h-4 inline mr-2" /> {t('模板视频', 'Template Video')}
          </button>
        </div>

        {mode === 'image2video' && (
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
              {t('图生视频：将产品图转为动态展示', 'Image to video: turn product images into motion')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              {t('可添加最多 ', 'Add up to ')}
              <strong>{MAX_PRODUCT_IMAGES}</strong>
              {t(' 张', ' ')}
              <strong>{t('同一产品', 'same product')}</strong>
              {t('的垫图（正面、侧面、细节等），便于还原真实外观。', ' reference images (front, side, details, etc.) to better match the real look. ')}
              {isVeo31 ? (
                <>
                  {t('选择 ', 'With ')}
                  <strong>Veo 3.1</strong>
                  {t(' 时，多张图会作为参考一并传入模型。', ', multiple images are sent to the model as references together.')}
                </>
              ) : (
                <>
                  {t('当前视频模型非 Veo 3.1 时，接口以第一张为主图，并在提示中附带多图说明（Runway 等仅支持单图输入）。', 'When the model is not Veo 3.1, the API uses the first image as primary and mentions other images in the prompt (Runway etc. only support a single image).')}
                </>
              )}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs text-slate-500 mb-2">{t('产品垫图（可多张）', 'Product reference images (multiple)')}</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={onImageSelect}
                />
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={productImages.length >= MAX_PRODUCT_IMAGES}
                    className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    {productImages.length >= MAX_PRODUCT_IMAGES ? t('已达上限', 'Limit reached') : t('添加图片', 'Add images')}
                  </button>
                  {productImages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setProductImages([])}
                      className="px-3 py-2 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      {t('清空全部', 'Clear all')}
                    </button>
                  )}
                  <span className="text-xs text-slate-500">
                    {t('已选 ', 'Selected ')}
                    {productImages.length}/{MAX_PRODUCT_IMAGES}
                    {t(' 张', ' images')}
                  </span>
                </div>
                {productImages.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-40 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center gap-2 text-slate-500 hover:border-sky-500 hover:text-sky-500"
                  >
                    <Upload className="w-8 h-8" /> {t('点击添加产品图', 'Click to add product images')}
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {productImages.map((src, i) => (
                      <div key={i} className="relative w-24 h-24 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800">
                        <img src={src} alt={t(`垫图 ${i + 1}`, `Reference ${i + 1}`)} className="w-full h-full object-cover" />
                        <span className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-[10px] font-medium text-white bg-black/60">
                          {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => setProductImages((p) => p.filter((_, j) => j !== i))}
                          className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow"
                          aria-label={t('删除', 'Remove')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3">
                  <label className="block text-xs text-slate-500 mb-1">{t('可选：动作/运镜描述（英文更佳）', 'Optional: motion / camera description (English works best)')}</label>
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
                {loading ? (
                  <div className="flex gap-2 mb-4">
                    <button
                      type="button"
                      disabled
                      className="flex-1 py-3 rounded-lg bg-sky-500/70 text-white flex items-center justify-center gap-2 cursor-not-allowed"
                    >
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t('生成中…', 'Generating…')}
                      {waitSec > 0 && ` (${waitSec}s)`}
                    </button>
                    <button
                      type="button"
                      onClick={stopGeneration}
                      className="px-5 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 flex items-center justify-center gap-2"
                    >
                      <Square className="w-4 h-4" /> {t('停止', 'Stop')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={runImage2Video}
                    className="w-full py-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 flex items-center justify-center gap-2 mb-4"
                  >
                    <Video className="w-5 h-5" /> {t('生成视频', 'Generate video')}
                  </button>
                )}
                {generatedVideoUrl && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-2">{t('生成结果', 'Result')}</label>
                    <video src={generatedVideoUrl} controls className="w-full rounded-lg border border-slate-200 dark:border-slate-700" />
                    <a href={generatedVideoUrl} download className="mt-2 inline-block text-sm text-sky-500 hover:underline">
                      {t('下载视频', 'Download video')}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {mode === 'text2video' && (
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
              {t('文生视频：根据描述生成宣传短片', 'Text to video: generate a promo clip from a description')}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-2">{t('视频描述 / 分镜脚本（英文效果更佳）', 'Video description / storyboard script (English often works better)')}</label>
                <textarea
                  value={textScript}
                  onChange={(e) => setTextScript(e.target.value)}
                  placeholder="e.g. A minimalist jacket on a mannequin, soft studio lighting, slow 360 rotation, white background"
                  rows={5}
                  className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                />
              </div>
              {loading ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled
                    className="flex-1 py-3 rounded-lg bg-sky-500/70 text-white flex items-center justify-center gap-2 cursor-not-allowed"
                  >
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t('生成中…', 'Generating…')}
                    {waitSec > 0 && ` (${waitSec}s)`}
                  </button>
                  <button
                    type="button"
                    onClick={stopGeneration}
                    className="px-5 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 flex items-center justify-center gap-2"
                  >
                    <Square className="w-4 h-4" /> {t('停止', 'Stop')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={runText2Video}
                  className="w-full py-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 flex items-center justify-center gap-2"
                >
                  <Video className="w-5 h-5" /> {t('生成视频', 'Generate video')}
                </button>
              )}
              {generatedVideoUrl && (
                <div>
                  <label className="block text-xs text-slate-500 mb-2">{t('生成结果', 'Result')}</label>
                  <video src={generatedVideoUrl} controls className="w-full rounded-lg border border-slate-200 dark:border-slate-700" />
                  <a href={generatedVideoUrl} download className="mt-2 inline-block text-sm text-sky-500 hover:underline">
                    {t('下载视频', 'Download video')}
                  </a>
                </div>
              )}
            </div>
          </section>
        )}

        {mode === 'template' && (
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-6">
              {(['upload', 'edit', 'generate'] as TemplateStep[]).map((step, i) => {
                const active = templateStep === step;
                const done = (['upload', 'edit', 'generate'] as TemplateStep[]).indexOf(templateStep) > i;
                return (
                  <div key={step} className="flex items-center gap-2">
                    {i > 0 && <ChevronRight className="w-4 h-4 text-slate-300" />}
                    <button
                      type="button"
                      onClick={() => {
                        if (done) setTemplateStep(step);
                      }}
                      disabled={!done && !active}
                      className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                        active
                          ? 'bg-purple-500 text-white'
                          : done
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-200 cursor-pointer'
                            : 'bg-slate-100 text-slate-400 dark:bg-slate-800 cursor-not-allowed'
                      }`}
                    >
                      {i + 1}. {templateStepLabels[i]}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Step 1: Upload */}
            {templateStep === 'upload' && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {t('上传参考视频（竞品/模板视频）', 'Upload reference video (competitor / template)')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t(
                    'AI 将分析参考视频的分镜结构（运镜、场景、节奏），供你替换产品图后批量重新生成。支持 MP4，建议 1 分钟内、不超过 20MB。',
                    'AI analyzes shot structure (camera, scenes, pacing) so you can swap in product images and regenerate in batch. MP4 supported; ~1 min and under 20MB recommended.'
                  )}
                </p>
                <input
                  ref={refVideoInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  onChange={onRefVideoSelect}
                />
                {!refVideoDataUrl ? (
                  <button
                    type="button"
                    onClick={() => refVideoInputRef.current?.click()}
                    className="w-full h-48 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex flex-col items-center justify-center gap-2 text-slate-500 hover:border-purple-500 hover:text-purple-500 transition-colors"
                  >
                    <Upload className="w-10 h-10" />
                    <span className="text-sm">{t('点击上传参考视频', 'Click to upload reference video')}</span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <video
                      src={refVideoDataUrl}
                      controls
                      className="w-full max-h-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-black"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRefVideoDataUrl(null);
                          setStoryboard(null);
                        }}
                        className="px-4 py-2 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="w-4 h-4 inline mr-1" /> {t('重新选择', 'Choose again')}
                      </button>
                      <button
                        type="button"
                        onClick={analyzeRefVideo}
                        disabled={analyzing}
                        className="flex-1 py-2 rounded-lg bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-60 flex items-center justify-center gap-2"
                      >
                        {analyzing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" /> {t('分析中（约 10-20 秒）…', 'Analyzing (~10–20s)…')}
                          </>
                        ) : (
                          <>
                            <Film className="w-4 h-4" /> {t('分析视频分镜', 'Analyze video storyboard')}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Edit storyboard */}
            {templateStep === 'edit' && storyboard && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {t('编辑分镜 · ', 'Edit storyboard · ')}
                    {storyboard.scenes.length}
                    {t(' 个场景 · 约 ', ' scenes · ~')}
                    {storyboard.totalDurationSec}
                    {t(' 秒', 's')}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setTemplateStep('upload')}
                    className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" /> {t('重新上传', 'Upload again')}
                  </button>
                </div>
                {(storyboard.summary || storyboard.detectedLanguage) && (
                  <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                    {storyboard.detectedLanguage && (
                      <span className="inline-block mr-2 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">
                        {storyboard.detectedLanguage === 'zh' ? t('检测到：中文', 'Detected: Chinese') : storyboard.detectedLanguage === 'en' ? t('检测到：英文', 'Detected: English') : `${t('检测到：', 'Detected: ')}${storyboard.detectedLanguage}`}
                      </span>
                    )}
                    {storyboard.style && <strong>{t('风格：', 'Style: ')}</strong>}
                    {storyboard.style}
                    {storyboard.style && storyboard.summary && ' · '}
                    {storyboard.summary}
                  </p>
                )}

                <input
                  ref={sceneImgInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || editingSceneIdx === null) return;
                    await setSceneProductImage(editingSceneIdx, file);
                    setEditingSceneIdx(null);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={globalImgInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const dataUrl = await new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(String(reader.result || ''));
                      reader.readAsDataURL(file);
                    });
                    const [compressed] = await compressImages([dataUrl]);
                    setGlobalProductImg(compressed);
                    e.target.value = '';
                  }}
                />

                {/* 全局产品图：一键应用到所有需要产品图的场景 */}
                <div className="rounded-lg border-2 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-purple-700 dark:text-purple-300">
                      {t('全局产品图（一键应用到所有场景）', 'Global Product Image (apply to all scenes)')}
                    </h3>
                    <span className="text-[10px] text-slate-500">
                      {storyboard.scenes.filter((s) => s.needsProductImage).length} {t('个场景需要产品图', ' scenes need product image')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {globalProductImg ? (
                      <>
                        <div className="relative w-14 h-14 rounded border-2 border-purple-400 overflow-hidden flex-shrink-0">
                          <img src={globalProductImg} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setGlobalProductImg(null)}
                            className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white flex items-center justify-center text-[8px] rounded-bl"
                          >
                            ×
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={replacingProduct || rewritingScenes}
                          onClick={async () => {
                            if (!globalProductImg || !storyboard || !apiKey?.trim()) return;
                            const hasFrames = storyboard.scenes.some((s) => s.frameDataUrl && s.needsProductImage);
                            if (!hasFrames) {
                              setError(t('未提取到原始帧，无法进行智能替换。请重新上传并分析参考视频。', 'No original frames extracted. Please re-upload and analyze the reference video.'));
                              return;
                            }
                            setReplacingProduct(true);
                            setReplaceProgress('');
                            setError(null);

                            // 1) 应用产品图到所有场景
                            setStoryboard((prev) => {
                              if (!prev) return prev;
                              const scenes = prev.scenes.map((s) =>
                                s.needsProductImage ? { ...s, productImageDataUrl: globalProductImg } : s
                              );
                              return { ...prev, scenes };
                            });

                            try {
                              // 2) 逐场景替换帧中的产品
                              const productScenes = storyboard.scenes.filter((s) => s.needsProductImage && s.frameDataUrl);
                              for (let si = 0; si < productScenes.length; si++) {
                                const scene = productScenes[si];
                                setReplaceProgress(t(
                                  `正在替换第 ${si + 1}/${productScenes.length} 个场景的产品…`,
                                  `Replacing product in scene ${si + 1}/${productScenes.length}…`
                                ));
                                try {
                                  const res = await fetch('/api/video/replace-product', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      apiKey: apiKey.trim(),
                                      frameDataUrl: scene.frameDataUrl,
                                      productImageDataUrl: globalProductImg,
                                      sceneDescription: scene.description,
                                    }),
                                  });
                                  const data = await res.json();
                                  if (res.ok && data.editedFrameDataUrl) {
                                    setStoryboard((prev) => {
                                      if (!prev) return prev;
                                      const updated = [...prev.scenes];
                                      const idx = updated.findIndex((s) => s.index === scene.index);
                                      if (idx >= 0) updated[idx] = { ...updated[idx], editedFrameDataUrl: data.editedFrameDataUrl };
                                      return { ...prev, scenes: updated };
                                    });
                                  } else {
                                    console.warn(`[replace-product] scene ${scene.index} failed:`, data.error);
                                  }
                                } catch (e) {
                                  console.warn(`[replace-product] scene ${scene.index} error:`, e);
                                }
                              }

                              // 3) 同时改写文案
                              setReplaceProgress(t('正在用 AI 改写文案…', 'AI rewriting scene descriptions…'));
                              const res = await fetch('/api/video/rewrite-scenes', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  apiKey: apiKey.trim(),
                                  productImageDataUrl: globalProductImg,
                                  scenes: storyboard.scenes.map((s) => ({
                                    index: s.index,
                                    description: s.description,
                                    subjectAction: s.subjectAction,
                                    textOverlay: s.textOverlay,
                                    props: s.props,
                                    needsProductImage: s.needsProductImage,
                                  })),
                                  style: storyboard.style,
                                }),
                              });
                              const data = await res.json();
                              if (res.ok && Array.isArray(data.scenes)) {
                                setStoryboard((prev) => {
                                  if (!prev) return prev;
                                  const updated = [...prev.scenes];
                                  for (const ns of data.scenes) {
                                    const idx = updated.findIndex((s) => s.index === ns.index);
                                    if (idx < 0) continue;
                                    const patch: Partial<AnalyzedScene> = {};
                                    if (typeof ns.description === 'string') patch.description = ns.description;
                                    if (typeof ns.subjectAction === 'string') patch.subjectAction = ns.subjectAction;
                                    if (ns.textOverlay !== undefined) patch.textOverlay = ns.textOverlay;
                                    if (typeof ns.props === 'string') patch.props = ns.props;
                                    updated[idx] = { ...updated[idx], ...patch };
                                  }
                                  return { ...prev, scenes: updated };
                                });
                              }
                            } catch (e) {
                              setError(e instanceof Error ? e.message : t('产品替换失败', 'Product replacement failed'));
                            } finally {
                              setReplacingProduct(false);
                              setReplaceProgress('');
                            }
                          }}
                          className="px-4 py-2 text-xs rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:from-purple-600 hover:to-indigo-600 font-medium disabled:opacity-60 flex items-center gap-1"
                        >
                          {(replacingProduct || rewritingScenes) && <Loader2 className="w-3 h-3 animate-spin" />}
                          {replacingProduct
                            ? replaceProgress || t('处理中…', 'Processing…')
                            : t('智能替换产品', 'Smart product swap')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!globalProductImg || !storyboard) return;
                            setStoryboard((prev) => {
                              if (!prev) return prev;
                              const scenes = prev.scenes.map((s) =>
                                s.needsProductImage ? { ...s, productImageDataUrl: globalProductImg } : s
                              );
                              return { ...prev, scenes };
                            });
                          }}
                          className="px-3 py-2 text-xs rounded border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                        >
                          {t('仅应用图片', 'Apply image only')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setStoryboard((prev) => {
                              if (!prev) return prev;
                              const scenes = prev.scenes.map((s) =>
                                s.needsProductImage ? { ...s, productImageDataUrl: undefined, editedFrameDataUrl: undefined } : s
                              );
                              return { ...prev, scenes };
                            });
                          }}
                          className="px-3 py-2 text-xs rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {t('清空所有', 'Clear all')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => globalImgInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 text-xs rounded-lg border-2 border-dashed border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:border-purple-500 hover:text-purple-700"
                      >
                        <Upload className="w-4 h-4" />
                        {t('上传产品图', 'Upload product image')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                  {storyboard.scenes.map((scene, idx) => (
                    <div
                      key={idx}
                      className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 flex items-center gap-1 text-slate-400">
                          <GripVertical className="w-4 h-4" />
                          <span className="text-xs font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full w-6 h-6 flex items-center justify-center">
                            {idx + 1}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                            <span>{scene.durationSec}s</span>
                            {scene.cameraMove && <span className="bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">{scene.cameraMove}</span>}
                            {scene.needsProductImage && (
                              <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                                {t('需产品图', 'Product image needed')}
                              </span>
                            )}
                            {scene.transition && <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">{scene.transition}</span>}
                          </div>
                          <textarea
                            value={scene.description}
                            onChange={(e) => updateSceneDescription(idx, e.target.value)}
                            rows={2}
                            className="w-full text-xs px-2 py-1.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 resize-y"
                          />
                          {(scene.background || scene.lighting || scene.composition || scene.subjectAction || scene.textOverlay || scene.colorGrading || scene.props) && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-purple-600 dark:text-purple-400 hover:underline">
                                {t('展开详细参数', 'Show scene details')}
                              </summary>
                              <div className="mt-1.5 space-y-1.5 pl-1 border-l-2 border-purple-200 dark:border-purple-800">
                                {scene.subjectAction && (
                                  <div>
                                    <span className="text-slate-500 font-medium">{t('主体动作', 'Action')}:</span>
                                    <input
                                      value={scene.subjectAction}
                                      onChange={(e) => setStoryboard((prev) => { if (!prev) return prev; const ss = [...prev.scenes]; ss[idx] = { ...ss[idx], subjectAction: e.target.value }; return { ...prev, scenes: ss }; })}
                                      className="ml-1 w-full text-xs px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                                    />
                                  </div>
                                )}
                                {scene.background && (
                                  <div>
                                    <span className="text-slate-500 font-medium">{t('背景', 'Background')}:</span>
                                    <input
                                      value={scene.background}
                                      onChange={(e) => setStoryboard((prev) => { if (!prev) return prev; const ss = [...prev.scenes]; ss[idx] = { ...ss[idx], background: e.target.value }; return { ...prev, scenes: ss }; })}
                                      className="ml-1 w-full text-xs px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                                    />
                                  </div>
                                )}
                                {scene.lighting && (
                                  <div>
                                    <span className="text-slate-500 font-medium">{t('灯光', 'Lighting')}:</span>
                                    <input
                                      value={scene.lighting}
                                      onChange={(e) => setStoryboard((prev) => { if (!prev) return prev; const ss = [...prev.scenes]; ss[idx] = { ...ss[idx], lighting: e.target.value }; return { ...prev, scenes: ss }; })}
                                      className="ml-1 w-full text-xs px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                                    />
                                  </div>
                                )}
                                {scene.colorGrading && (
                                  <div>
                                    <span className="text-slate-500 font-medium">{t('色调', 'Color')}:</span>
                                    <input
                                      value={scene.colorGrading}
                                      onChange={(e) => setStoryboard((prev) => { if (!prev) return prev; const ss = [...prev.scenes]; ss[idx] = { ...ss[idx], colorGrading: e.target.value }; return { ...prev, scenes: ss }; })}
                                      className="ml-1 w-full text-xs px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                                    />
                                  </div>
                                )}
                                {scene.composition && (
                                  <div>
                                    <span className="text-slate-500 font-medium">{t('构图', 'Composition')}:</span>
                                    <input
                                      value={scene.composition}
                                      onChange={(e) => setStoryboard((prev) => { if (!prev) return prev; const ss = [...prev.scenes]; ss[idx] = { ...ss[idx], composition: e.target.value }; return { ...prev, scenes: ss }; })}
                                      className="ml-1 w-full text-xs px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                                    />
                                  </div>
                                )}
                                {scene.textOverlay && (
                                  <div>
                                    <span className="text-slate-500 font-medium">{t('文字叠加', 'Text overlay')}:</span>
                                    <input
                                      value={scene.textOverlay}
                                      onChange={(e) => setStoryboard((prev) => { if (!prev) return prev; const ss = [...prev.scenes]; ss[idx] = { ...ss[idx], textOverlay: e.target.value }; return { ...prev, scenes: ss }; })}
                                      className="ml-1 w-full text-xs px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                                    />
                                  </div>
                                )}
                                {scene.props && (
                                  <div>
                                    <span className="text-slate-500 font-medium">{t('道具', 'Props')}:</span>
                                    <input
                                      value={scene.props}
                                      onChange={(e) => setStoryboard((prev) => { if (!prev) return prev; const ss = [...prev.scenes]; ss[idx] = { ...ss[idx], props: e.target.value }; return { ...prev, scenes: ss }; })}
                                      className="ml-1 w-full text-xs px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                                    />
                                  </div>
                                )}
                              </div>
                            </details>
                          )}
                          {(scene.frameDataUrl || scene.editedFrameDataUrl) && (
                            <div className="flex items-center gap-2 flex-wrap">
                              {scene.frameDataUrl && (
                                <div className="text-center">
                                  <div className="w-24 h-14 rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
                                    <img src={scene.frameDataUrl} alt="" className="w-full h-full object-cover" />
                                  </div>
                                  <span className="text-[10px] text-slate-400">{t('原始帧', 'Original')}</span>
                                </div>
                              )}
                              {scene.editedFrameDataUrl && (
                                <div className="text-center">
                                  <div className="w-24 h-14 rounded border-2 border-green-400 dark:border-green-600 overflow-hidden">
                                    <img src={scene.editedFrameDataUrl} alt="" className="w-full h-full object-cover" />
                                  </div>
                                  <span className="text-[10px] text-green-600 dark:text-green-400">{t('替换后', 'Replaced')}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {scene.needsProductImage && (
                            <div className="flex items-center gap-2">
                              {scene.productImageDataUrl ? (
                                <div className="relative w-16 h-16 rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
                                  <img src={scene.productImageDataUrl} alt="" className="w-full h-full object-cover" />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStoryboard((prev) => {
                                        if (!prev) return prev;
                                        const scenes = [...prev.scenes];
                                        scenes[idx] = { ...scenes[idx], productImageDataUrl: undefined, editedFrameDataUrl: undefined };
                                        return { ...prev, scenes };
                                      });
                                    }}
                                    className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white flex items-center justify-center text-[8px] rounded-bl"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSceneIdx(idx);
                                    sceneImgInputRef.current?.click();
                                  }}
                                  className="h-16 px-3 rounded border border-dashed border-slate-300 dark:border-slate-600 text-xs text-slate-500 hover:border-purple-500 hover:text-purple-500 flex items-center gap-1"
                                >
                                  <Plus className="w-3 h-3" /> {t('添加产品图', 'Add product image')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeScene(idx)}
                          className="flex-shrink-0 p-1 text-slate-400 hover:text-red-500"
                          title={t('删除场景', 'Remove scene')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    {t('预计总时长 ', 'Estimated total ')}
                    <strong>{storyboard.scenes.reduce((a, s) => a + (s.durationSec || 6), 0)}</strong>
                    {t(' 秒 · 预计生成约 ', 's · generation ~')}
                    <strong>{Math.ceil(storyboard.scenes.length * 1.2)}</strong>
                    {t(' 分钟', ' min')}
                  </p>
                  <button
                    type="button"
                    onClick={startStoryboardGeneration}
                    disabled={storyboard.scenes.length === 0}
                    className="px-6 py-2.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 flex items-center gap-2 font-medium text-sm"
                  >
                    <Video className="w-4 h-4" /> {t('开始批量生成', 'Start batch generation')}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Generate & concatenate */}
            {templateStep === 'generate' && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('批量生成进度', 'Batch generation progress')}</h2>
                {sbStatus === 'generating' || sbStatus === 'concatenating' || sbStatus === 'submitting' ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                    {sbStatus === 'concatenating'
                      ? t('所有场景已完成，正在拼接最终视频…', 'All scenes done; stitching final video…')
                      : sbStatus === 'submitting'
                        ? t('正在提交任务…', 'Submitting job…')
                        : t('场景逐个生成中，每个约 1-2 分钟…', 'Generating scenes one by one, ~1–2 min each…')}
                  </p>
                ) : null}

                <div className="space-y-2">
                  {sbSceneStatuses.map((ss) => (
                    <div key={ss.index} className="flex items-center gap-3 text-xs">
                      <span className="w-16 text-right text-slate-500">
                        {t('场景 ', 'Scene ')}
                        {ss.index + 1}
                      </span>
                      <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 flex items-center px-2 text-white text-[10px] font-medium ${
                            ss.status === 'done'
                              ? 'bg-green-500 w-full'
                              : ss.status === 'generating' || ss.status === 'submitting'
                                ? 'bg-purple-500 w-2/3 animate-pulse'
                                : ss.status === 'error'
                                  ? 'bg-red-500 w-full'
                                  : 'bg-slate-300 dark:bg-slate-700 w-0'
                          }`}
                        >
                          {ss.status === 'done'
                            ? t('完成', 'Done')
                            : ss.status === 'generating'
                              ? t('生成中…', 'Generating…')
                              : ss.status === 'submitting'
                                ? t('提交中…', 'Submitting…')
                                : ss.status === 'error'
                                  ? t('失败', 'Failed')
                                  : t('等待', 'Waiting')}
                        </div>
                      </div>
                      {ss.error && (
                        <span className="text-red-500 max-w-[200px] truncate" title={ss.error}>
                          {ss.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* 分段视频预览：只要有完成的场景就显示 */}
                {sbSceneStatuses.some((ss) => ss.status === 'done' && ss.streamUrl) && (
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                    <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      {t('分段视频预览', 'Scene Previews')}
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {sbSceneStatuses.filter((ss) => ss.status === 'done' && ss.streamUrl).map((ss) => (
                        <div key={ss.index} className="space-y-1">
                          <video
                            src={ss.streamUrl}
                            controls
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-black aspect-video"
                          />
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">{t('场景', 'Scene')} {ss.index + 1}</span>
                            <a
                              href={ss.streamUrl}
                              download={`scene-${ss.index + 1}.mp4`}
                              className="text-[10px] text-sky-500 hover:underline"
                            >
                              {t('下载', 'DL')}
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {sbStatus === 'done' && sbFinalUrl && (
                  <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">{t('视频生成完毕！', 'Video ready!')}</p>
                    <video src={sbFinalUrl} controls className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-black" />
                    <a
                      href={sbFinalUrl}
                      download="product-video.mp4"
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-green-500 text-white hover:bg-green-600"
                    >
                      <Download className="w-4 h-4" /> {t('下载视频', 'Download video')}
                    </a>
                  </div>
                )}

                {sbStatus === 'error' && sbError && (
                  <div className="space-y-3">
                    <p className="text-sm text-red-500">{sbError}</p>
                    <div className="flex flex-wrap gap-2">
                      {storyboardJobId && sbSceneStatuses.some((ss) => ss.status === 'done') && (
                        <button
                          type="button"
                          onClick={async () => {
                            setSbError(null);
                            setSbStatus('concatenating');
                            try {
                              const res = await fetch(`/api/video/storyboard/retry-concat/${encodeURIComponent(storyboardJobId)}`, { method: 'POST' });
                              const data = await res.json();
                              if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                              setSbStatus('concatenating');
                            } catch (e) {
                              setSbError(e instanceof Error ? e.message : t('重试失败', 'Retry failed'));
                              setSbStatus('error');
                            }
                          }}
                          className="px-4 py-2 text-sm rounded-lg bg-purple-500 text-white hover:bg-purple-600 flex items-center gap-2"
                        >
                          <Video className="w-4 h-4" /> {t('重新拼接', 'Retry Concat')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setTemplateStep('edit');
                          setSbStatus('');
                          setStoryboardJobId(null);
                          setSbError(null);
                        }}
                        className="px-4 py-2 text-sm rounded border border-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <ArrowLeft className="w-4 h-4 inline mr-1" /> {t('返回编辑分镜', 'Back to edit storyboard')}
                      </button>
                    </div>
                  </div>
                )}

                {sbStatus === 'done' && (
                  <button
                    type="button"
                    onClick={() => {
                      setTemplateStep('upload');
                      setRefVideoDataUrl(null);
                      setStoryboard(null);
                      setStoryboardJobId(null);
                      setSbStatus('');
                      setSbFinalUrl(null);
                      setSbSceneStatuses([]);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" /> {t('重新开始', 'Start over')}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
