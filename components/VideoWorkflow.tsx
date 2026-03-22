'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Image as ImageIcon, Video, Upload, Plus, Trash2 } from 'lucide-react';

type VideoWorkflowProps = { apiKey: string; videoApiKey: string; videoModel: string };

type TabMode = 'image2video' | 'text2video';

/** 产品垫图最多张数：与 Veo 3.1 多图参考上限一致 */
const MAX_PRODUCT_IMAGES = 3;

/** 略大于视频 API route（maxDuration 约 320s），避免浏览器无限等待 */
const CLIENT_VIDEO_TIMEOUT_MS = 340000;

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

  const postVideoApi = useCallback((path: string, body: Record<string, unknown>) => {
    videoAbortRef.current?.abort();
    const ctrl = new AbortController();
    videoAbortRef.current = ctrl;
    const killTimer = setTimeout(() => ctrl.abort(), CLIENT_VIDEO_TIMEOUT_MS);
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).then(
      async (res) => {
        let data: { error?: string; videoUrl?: string; url?: string } = {};
        try {
          data = await res.json();
        } catch (_parseErr) {
          /* 非 JSON 响应 */
        }
        if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
        return data;
      }
    ).then(
      (data) => {
        clearTimeout(killTimer);
        return data;
      },
      (err) => {
        clearTimeout(killTimer);
        throw err;
      }
    );
  }, []);

  const onImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const room = MAX_PRODUCT_IMAGES - productImages.length;
    if (room <= 0) {
      e.target.value = '';
      return;
    }
    const count = Math.min(files.length, room);
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
          setProductImages((prev) => [...prev, ...ordered].slice(0, MAX_PRODUCT_IMAGES));
        }
      };
      reader.readAsDataURL(files[i]);
    }
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
      const data = await postVideoApi('/api/video/image2video', {
        apiKey: effectiveKey,
        model: videoModel,
        imageDataUrls: productImages,
        prompt: videoPrompt || undefined,
      });
      setGeneratedVideoUrl(data.videoUrl || data.url || null);
    } catch (e) {
      if (isAbortLike(e)) {
        setError(
          '请求超时或连接中断（视频接口常需数分钟）。请直接再点「生成视频」重试；若反复出现，检查网络或稍后再试。'
        );
      } else {
        setError(e instanceof Error ? e.message : '图生视频失败');
      }
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
      const data = await postVideoApi('/api/video/text2video', {
        apiKey: effectiveKey,
        model: videoModel,
        prompt: textScript,
        ...(videoModel.startsWith('veo-') ? { aspectRatio: veoAspectRatio } : {}),
      });
      setGeneratedVideoUrl(data.videoUrl || data.url || null);
    } catch (e) {
      if (isAbortLike(e)) {
        setError(
          '请求超时或连接中断（视频接口常需数分钟）。请直接再点「生成视频」重试；若反复出现，检查网络或稍后再试。'
        );
      } else {
        setError(e instanceof Error ? e.message : '文生视频失败');
      }
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
            已等待 <strong>{waitSec}</strong> 秒。视频生成通常需要 2～6 分钟，页面会一直保持「生成中」直至完成；若超过约 6 分钟仍无结果，会自动结束并提示重试。
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
