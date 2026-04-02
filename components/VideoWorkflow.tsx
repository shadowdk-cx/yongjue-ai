'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Image as ImageIcon, Video, Upload, Plus, Trash2, Square } from 'lucide-react';
import { compressImages } from '@/lib/compress-image';

type VideoWorkflowProps = { apiKey: string; videoApiKey: string; videoModel: string };

type TabMode = 'image2video' | 'text2video';

/** 产品垫图最多张数：与 Veo 3.1 多图参考上限一致 */
const MAX_PRODUCT_IMAGES = 3;

/** 整段流程（提交 + 多次轮询）上限，略大于服务端任务有效期 */
const CLIENT_VIDEO_TIMEOUT_MS = 340000;

const POLL_INTERVAL_MS = 8000;

async function readApiJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`服务器返回非 JSON（HTTP ${res.status}）`);
  }
}

function isAbortLike(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'AbortError') return true;
  return /aborted|AbortError|The user aborted/i.test(e.message);
}

export function VideoWorkflow({ apiKey, videoApiKey, videoModel }: VideoWorkflowProps) {
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

  const pollUntilVideoReady = useCallback(async (jobId: string, signal: AbortSignal) => {
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
        throw new Error('已完成但未返回视频地址');
      }
      if (status === 'error') {
        throw new Error(typeof data.error === 'string' ? data.error : '视频生成失败');
      }
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `轮询失败 (${res.status})`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error('等待视频超时，请重试');
  }, []);

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
          throw new Error(typeof data.error === 'string' ? data.error : `请求失败 (${res.status})`);
        }
        const jobId = typeof data.jobId === 'string' ? data.jobId : '';
        if (!jobId) {
          throw new Error('服务器未返回任务 ID，请刷新页面后重试');
        }
        return await pollUntilVideoReady(jobId, ctrl.signal);
      } finally {
        clearTimeout(killTimer);
      }
    },
    [pollUntilVideoReady]
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
          ? '请填写 Gemini API Key（配置栏）并至少上传一张产品图'
          : '请填写视频 API Key（Runway）并至少上传一张产品图'
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
      const url = await runVideoJob('/api/video/text2video', {
        apiKey: effectiveKey,
        model: videoModel,
        prompt: textScript,
        ...(videoModel.startsWith('veo-') ? { aspectRatio: veoAspectRatio } : {}),
      });
      setGeneratedVideoUrl(url || null);
    } catch (e) {
      if (isAbortLike(e)) return;
      setError(e instanceof Error ? e.message : '文生视频失败');
    } finally {
      setLoading(false);
    }
  };

  const stopGeneration = useCallback(() => {
    videoAbortRef.current?.abort();
    videoAbortRef.current = null;
    setLoading(false);
    setError('已停止生成');
  }, []);

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          选择 <strong>Gemini Veo 2 / Veo 3.1</strong> 时使用配置栏的 <strong>Gemini API Key</strong>；选择 Runway / 可灵 / Luma 时请填写「视频 API Key」。
        </p>
        {videoModel.startsWith('veo-') && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-slate-600 dark:text-slate-400">Veo 画幅</label>
            <select
              value={veoAspectRatio}
              onChange={(e) => setVeoAspectRatio(e.target.value as '16:9' | '9:16')}
              disabled={loading}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
            >
              <option value="9:16">竖屏 9:16（手机电商）</option>
              <option value="16:9">横屏 16:9</option>
            </select>
          </div>
        )}
        {loading && (
          <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            已等待 <strong>{waitSec}</strong> 秒。视频采用<strong>分段轮询</strong>（每 {POLL_INTERVAL_MS / 1000} 秒查询一次），适合线上部署；通常 2～6 分钟完成。超过约 5～6 分钟无结果会提示超时重试。
          </p>
        )}
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
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              可添加最多 <strong>{MAX_PRODUCT_IMAGES}</strong> 张<strong>同一产品</strong>的垫图（正面、侧面、细节等），便于还原真实外观。
              {isVeo31 ? (
                <>
                  {' '}
                  选择 <strong>Veo 3.1</strong> 时，多张图会作为参考一并传入模型。
                </>
              ) : (
                <>
                  {' '}
                  当前视频模型非 Veo 3.1 时，接口以第一张为主图，并在提示中附带多图说明（Runway 等仅支持单图输入）。
                </>
              )}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs text-slate-500 mb-2">产品垫图（可多张）</label>
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
                    {productImages.length >= MAX_PRODUCT_IMAGES ? '已达上限' : '添加图片'}
                  </button>
                  {productImages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setProductImages([])}
                      className="px-3 py-2 text-sm rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      清空全部
                    </button>
                  )}
                  <span className="text-xs text-slate-500">
                    已选 {productImages.length}/{MAX_PRODUCT_IMAGES} 张
                  </span>
                </div>
                {productImages.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-40 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center gap-2 text-slate-500 hover:border-sky-500 hover:text-sky-500"
                  >
                    <Upload className="w-8 h-8" /> 点击添加产品图
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {productImages.map((src, i) => (
                      <div key={i} className="relative w-24 h-24 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800">
                        <img src={src} alt={`垫图 ${i + 1}`} className="w-full h-full object-cover" />
                        <span className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-[10px] font-medium text-white bg-black/60">
                          {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => setProductImages((p) => p.filter((_, j) => j !== i))}
                          className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow"
                          aria-label="删除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                {loading ? (
                  <div className="flex gap-2 mb-4">
                    <button
                      type="button"
                      disabled
                      className="flex-1 py-3 rounded-lg bg-sky-500/70 text-white flex items-center justify-center gap-2 cursor-not-allowed"
                    >
                      <Loader2 className="w-5 h-5 animate-spin" />
                      生成中… {waitSec > 0 && `(${waitSec}s)`}
                    </button>
                    <button
                      type="button"
                      onClick={stopGeneration}
                      className="px-5 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 flex items-center justify-center gap-2"
                    >
                      <Square className="w-4 h-4" /> 停止
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={runImage2Video}
                    className="w-full py-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 flex items-center justify-center gap-2 mb-4"
                  >
                    <Video className="w-5 h-5" /> 生成视频
                  </button>
                )}
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
              {loading ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled
                    className="flex-1 py-3 rounded-lg bg-sky-500/70 text-white flex items-center justify-center gap-2 cursor-not-allowed"
                  >
                    <Loader2 className="w-5 h-5 animate-spin" />
                    生成中… {waitSec > 0 && `(${waitSec}s)`}
                  </button>
                  <button
                    type="button"
                    onClick={stopGeneration}
                    className="px-5 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 flex items-center justify-center gap-2"
                  >
                    <Square className="w-4 h-4" /> 停止
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={runText2Video}
                  className="w-full py-3 rounded-lg bg-sky-500 text-white hover:bg-sky-600 flex items-center justify-center gap-2"
                >
                  <Video className="w-5 h-5" /> 生成视频
                </button>
              )}
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
