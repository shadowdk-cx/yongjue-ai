'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Save, Trash2, Sparkles, Clock, ChevronDown, ChevronUp, X } from 'lucide-react';

type TextWorkflowProps = { apiKey: string; provider: 'gemini' | 'openai'; textModel: string };

const DEFAULT_TITLE_PROMPT_EN = `你是一位跨境电商SEO专家。根据以下产品信息，生成符合亚马逊/独立站规范的英文产品标题。要求：包含核心关键词、卖点词、控制在80-200字符、无夸大违禁词。`;
const DEFAULT_TITLE_PROMPT_ZH = `根据产品信息，生成符合国内电商/抖音或亚马逊中文站的产品标题。要求：包含核心关键词、卖点词、简洁有力、无夸大违禁词。`;

const DEFAULT_BULLET_PROMPT_EN = `根据产品信息，生成3-5条英文Bullet Points，每条简洁有力，突出功能、材质、使用场景与差异化卖点。`;
const DEFAULT_BULLET_PROMPT_ZH = `根据产品信息，生成3-5条卖点，每条简洁有力，突出功能、材质、使用场景与差异化卖点。`;

const DEFAULT_DESC_PROMPT_EN = `根据产品信息，生成一段英文产品详情描述（Product Description），包含用途、规格、材质、适用人群与使用场景，适合亚马逊A+或独立站详情页。`;
const DEFAULT_DESC_PROMPT_ZH = `根据产品信息，生成一段产品详情描述，包含用途、规格、材质、适用人群与使用场景，适合抖音/国内电商或亚马逊中文详情页。`;

type HistoryItem = {
  id: string;
  time: string;
  platform: string;
  language: string;
  input: string;
  title: string;
  bullets: string;
  description: string;
  parsedFields?: Record<string, string>;
};

const HISTORY_KEY = 'ecom_ai_text_history';

function loadHistory(): HistoryItem[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(HISTORY_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
  } catch { /* ignore */ }
}

export function TextWorkflow({ apiKey, provider, textModel }: TextWorkflowProps) {
  const [titlePrompt, setTitlePrompt] = useState(DEFAULT_TITLE_PROMPT_EN);
  const [bulletPrompt, setBulletPrompt] = useState(DEFAULT_BULLET_PROMPT_EN);
  const [descPrompt, setDescPrompt] = useState(DEFAULT_DESC_PROMPT_EN);
  const [originalTitle, setOriginalTitle] = useState('');
  const [originalBullets, setOriginalBullets] = useState('');
  const [originalDesc, setOriginalDesc] = useState('');
  const [platform, setPlatform] = useState('amazon');
  const [language, setLanguage] = useState('en');
  const [optimizedTitle, setOptimizedTitle] = useState('');
  const [optimizedBullets, setOptimizedBullets] = useState('');
  const [optimizedDesc, setOptimizedDesc] = useState('');
  const [parsedFields, setParsedFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { setHistory(loadHistory()); }, []);

  const addToHistory = useCallback((title: string, bullets: string, description: string, fields?: Record<string, string>) => {
    const item: HistoryItem = {
      id: Date.now().toString(),
      time: new Date().toLocaleString('zh-CN'),
      platform,
      language,
      input: [originalTitle, originalBullets, originalDesc].filter(Boolean).join(' | ').slice(0, 80),
      title,
      bullets,
      description,
      parsedFields: fields,
    };
    const next = [item, ...history].slice(0, 50);
    setHistory(next);
    saveHistory(next);
  }, [history, platform, language, originalTitle, originalBullets, originalDesc]);

  const restoreFromHistory = (item: HistoryItem) => {
    setOptimizedTitle(item.title);
    setOptimizedBullets(item.bullets);
    setOptimizedDesc(item.description);
    if (item.parsedFields) setParsedFields(item.parsedFields);
    setShowHistory(false);
  };

  const removeHistory = (id: string) => {
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    saveHistory(next);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const rawProductInfo = [
    originalTitle,
    originalBullets,
    originalDesc,
  ].filter(Boolean).join('\n\n');

  const runParse = async () => {
    if (!apiKey || !rawProductInfo.trim()) {
      setError('请填写 API Key 和至少一项产品信息');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/text/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, provider, model: textModel, productInfo: rawProductInfo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '解析失败');
      setParsedFields(data.fields || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败');
    } finally {
      setLoading(false);
    }
  };

  const runGenerate = async () => {
    if (!apiKey || !rawProductInfo.trim()) {
      setError('请填写 API Key 和至少一项产品信息');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/text/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey, provider, model: textModel, platform, language,
          productInfo: rawProductInfo,
          prompts: { title: titlePrompt, bullets: bulletPrompt, description: descPrompt },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      setOptimizedTitle(data.title || '');
      setOptimizedBullets(data.bullets || '');
      setOptimizedDesc(data.description || '');
      addToHistory(data.title || '', data.bullets || '', data.description || '', parsedFields);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const restoreDefaults = () => {
    const isZh = language === 'zh';
    setTitlePrompt(isZh ? DEFAULT_TITLE_PROMPT_ZH : DEFAULT_TITLE_PROMPT_EN);
    setBulletPrompt(isZh ? DEFAULT_BULLET_PROMPT_ZH : DEFAULT_BULLET_PROMPT_EN);
    setDescPrompt(isZh ? DEFAULT_DESC_PROMPT_ZH : DEFAULT_DESC_PROMPT_EN);
  };

  const clearResults = () => {
    setOptimizedTitle('');
    setOptimizedBullets('');
    setOptimizedDesc('');
    setParsedFields({});
  };

  useEffect(() => {
    restoreDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const platformLabel = (p: string) => p === 'amazon' ? '亚马逊' : p === 'douyin' ? '抖音/国内' : '独立站';

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-[1800px] mx-auto">
        {/* 左侧 */}
        <div className="space-y-4">
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">产品原始信息</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">原始标题</label>
                <input value={originalTitle} onChange={(e) => setOriginalTitle(e.target.value)} placeholder="产品原始标题" className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">原始卖点</label>
                <textarea value={originalBullets} onChange={(e) => setOriginalBullets(e.target.value)} placeholder="卖点1&#10;卖点2" rows={3} className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">产品描述（用途/规格/人群）</label>
                <textarea value={originalDesc} onChange={(e) => setOriginalDesc(e.target.value)} placeholder="用途、场景、规格、人群..." rows={4} className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y" />
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">提示词配置</h2>
              <div className="flex gap-2">
                <button type="button" onClick={restoreDefaults} className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
                  恢复默认
                </button>
                <button type="button" onClick={clearResults} className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> 清空结果
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">标题生成提示词</label>
                <textarea value={titlePrompt} onChange={(e) => setTitlePrompt(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">卖点生成提示词</label>
                <textarea value={bulletPrompt} onChange={(e) => setBulletPrompt(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">描述生成提示词</label>
                <textarea value={descPrompt} onChange={(e) => setDescPrompt(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y" />
              </div>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
              <option value="amazon">亚马逊</option>
              <option value="douyin">抖音/国内</option>
              <option value="shopify">独立站/Shopify</option>
            </select>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
            <button type="button" onClick={runParse} disabled={loading} className="px-4 py-2 text-sm rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              AI 解析产品特征
            </button>
            <button type="button" onClick={runGenerate} disabled={loading} className="px-4 py-2 text-sm rounded bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              生成标题 / 卖点 / 详情
            </button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        {/* 中间 + 右侧 */}
        <div className="lg:col-span-2 space-y-4">
          {/* 历史记录 */}
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg"
            >
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                历史记录（{history.length}）
              </span>
              {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showHistory && (
              <div className="px-4 pb-4">
                {history.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">暂无生成记录</p>
                ) : (
                  <>
                    <div className="flex justify-end mb-2">
                      <button type="button" onClick={clearHistory} className="text-xs text-red-500 hover:underline">清空全部历史</button>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto scrollbar-thin">
                      {history.map((item) => (
                        <div key={item.id} className="flex items-start gap-2 p-2 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => restoreFromHistory(item)}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs text-slate-400">{item.time}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">{platformLabel(item.platform)}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">{item.language === 'zh' ? '中文' : 'EN'}</span>
                            </div>
                            <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{item.title || item.input || '(无标题)'}</p>
                          </div>
                          <button type="button" onClick={() => removeHistory(item.id)} className="shrink-0 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          {/* 生成结果 */}
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">生成结果</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">优化标题</label>
                <input value={optimizedTitle} onChange={(e) => setOptimizedTitle(e.target.value)} placeholder="生成后将显示于此" className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">产品卖点 (Bullet Points)</label>
                <textarea value={optimizedBullets} onChange={(e) => setOptimizedBullets(e.target.value)} rows={5} className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">详情描述</label>
                <textarea value={optimizedDesc} onChange={(e) => setOptimizedDesc(e.target.value)} rows={6} className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y" />
              </div>
            </div>
            <div className="mt-3">
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
                onClick={() => {
                  const text = `Title:\n${optimizedTitle}\n\nBullet Points:\n${optimizedBullets}\n\nDescription:\n${optimizedDesc}`;
                  const blob = new Blob([text], { type: 'text/plain' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `product-copy-${platform}-${language}-${Date.now()}.txt`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                <Save className="w-4 h-4" /> 保存到文件
              </button>
            </div>
          </section>

          {/* 产品画像 */}
          <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">AI 解析 - 产品画像</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                ['productTitle', '产品标题'],
                ['functionalSellingPoints', '功能卖点'],
                ['coreFeaturesAndParams', '核心功能与技术参数'],
                ['targetAudience', '主要用户群体'],
                ['useScenarios', '典型使用场景'],
                ['technicalSellingPoints', '核心技术卖点'],
                ['verifiedPurchaseReasons', '已验证购买理由'],
                ['painPoints', '明确痛点问题'],
                ['materialCraft', '材质工艺'],
                ['competitorAdvantage', '竞品对比优势'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-slate-500 mb-1">{label}</label>
                  <textarea
                    value={parsedFields[key] || ''}
                    onChange={(e) => setParsedFields((p) => ({ ...p, [key]: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 resize-y"
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
