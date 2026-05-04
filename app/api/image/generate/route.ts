import { NextRequest, NextResponse } from 'next/server';
import { createOpenAI } from '@/lib/openai';
import { createGeminiClient, generateImageGemini, buildImageRefinePrompt } from '@/lib/gemini';
import { wanxTextToImage } from '@/lib/qwen';
import { generateImageOpenRouter } from '@/lib/openrouter';
import { createDetaler } from '@/lib/detaler';
import { toFile } from 'openai/uploads';
import { formatUpstreamError } from '@/lib/format-upstream-error';
import { persistDataUrlAsPublicUrl } from '@/lib/persist-artifact';
import { createImageJob } from '@/lib/image-jobs';

export const maxDuration = 300;

const SIZE_MAP: Record<string, '1024x1024' | '1792x1024' | '1024x1792'> = {
  '1024x1024': '1024x1024',
  '1792x1024': '1792x1024',
  '1024x1792': '1024x1792',
};
const DETALER_SUPPORTED_IMAGE_MODELS = new Set(['gpt-image-1', 'gpt-image-1.5']);
const DETALER_MODEL_ALIASES: Record<string, string> = {
  'chatgpt-image-2.0': 'gpt-image-1.5',
};
/** 界面「实验」选项对应 Detaler 上游单一模型 ID（不做自动切换） */
const DETALER_EXPERIMENTAL_UPSTREAM: Record<string, string> = {
  'nano-banana-2.0-exp': 'gemini-3.1-flash-image-preview',
};

const DETALER_SINGLE_CALL_MS = 180_000;

function appendDetalerManualHint(message: string): string {
  if (/手动切换|未自动更换模型/i.test(message)) return message;
  return `${message}\n\n提示：当前不会自动更换模型。若失败，请在「生图模型」中手动切换到 gpt-image-1 / gpt-image-1.5（或 ChatGPT Image 2.0）；垫图若不被当前模型支持，也需更换模型或先移除垫图再试。`;
}

function resolveDetalerUpstreamModel(rawModel: string): string {
  if (Object.prototype.hasOwnProperty.call(DETALER_EXPERIMENTAL_UPSTREAM, rawModel)) {
    return DETALER_EXPERIMENTAL_UPSTREAM[rawModel];
  }
  return normalizeDetalerModel(rawModel);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Detaler 请求超时（${Math.round(ms / 1000)}s）`)), ms);
    }),
  ]);
}

function normalizeDetalerModel(model?: string) {
  const raw = (model || 'gpt-image-1').trim();
  return DETALER_MODEL_ALIASES[raw] || raw;
}

function parseImageDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) throw new Error('图片格式无效（需要 data:image/...;base64）');
  return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

async function generateDetalerImageUrl(args: {
  apiKey: string;
  model?: string;
  prompt: string;
  size: string;
  refImages?: string[];
}) {
  const client = createDetaler(args.apiKey);
  const sizeOption = SIZE_MAP[args.size] || '1024x1024';
  const imageModel = args.model || 'gpt-image-1';
  const prompt = args.prompt.trim();

  if (args.refImages && args.refImages.length > 0) {
    const parsed = parseImageDataUrl(args.refImages[0]);
    const file = await toFile(parsed.buffer, 'reference.png', { type: parsed.mimeType });
    const edited = await client.images.edit({
      model: imageModel,
      image: file as any,
      prompt,
      size: sizeOption,
    } as any);
    const d = (edited as any)?.data?.[0];
    if (typeof d?.b64_json === 'string' && d.b64_json) {
      return persistDataUrlAsPublicUrl(`data:image/png;base64,${d.b64_json}`);
    }
    if (typeof d?.url === 'string' && d.url) return d.url as string;
    throw new Error('Detaler 图文生图未返回图片');
  }

  const res = await client.images.generate({
    model: imageModel,
    prompt,
    n: 1,
    size: sizeOption,
  } as any);
  const data = (res as any)?.data?.[0];
  if (typeof data?.b64_json === 'string' && data.b64_json) {
    return persistDataUrlAsPublicUrl(`data:image/png;base64,${data.b64_json}`);
  }
  const url = data?.url as string | undefined;
  if (!url) throw new Error('Detaler 未返回图片');
  return url;
}

async function runDetalerGeneration(args: {
  apiKey: string;
  upstreamModel: string;
  prompt: string;
  size: string;
  refImages?: string[];
}): Promise<string> {
  return withTimeout(
    generateDetalerImageUrl({
      apiKey: args.apiKey,
      model: args.upstreamModel,
      prompt: args.prompt,
      size: args.size,
      refImages: args.refImages,
    }),
    DETALER_SINGLE_CALL_MS
  );
}

export async function POST(req: NextRequest) {
  const _reqStart = Date.now();
  try {
    const body = await req.json();
    const {
      apiKey,
      provider = 'gemini',
      model,
      prompt,
      size = '1024x1024',
      baseImage,
      baseImages,
      mode,
      refineInstruction,
      promptLanguage = 'zh',
      asyncMode = false,
    } = body as {
      apiKey?: string;
      provider?: 'gemini' | 'openai' | 'qwen' | 'openrouter' | 'detaler';
      model?: string;
      prompt?: string;
      size?: string;
      baseImage?: string;
      baseImages?: string[];
      mode?: string;
      refineInstruction?: string;
      promptLanguage?: 'en' | 'zh';
      asyncMode?: boolean;
    };
    if (!apiKey?.trim()) {
      return NextResponse.json({ error: '缺少 apiKey' }, { status: 400 });
    }
    const refImages = Array.isArray(baseImages) && baseImages.length > 0 ? baseImages : baseImage ? [baseImage] : undefined;

    if (mode === 'refine') {
      if (provider !== 'gemini' && provider !== 'detaler') {
        return NextResponse.json({ error: '图片精修仅支持 Gemini / Detaler 生图（请在工具里切换服务商）' }, { status: 400 });
      }
      const instr = String(refineInstruction || '').trim();
      if (!instr) {
        return NextResponse.json({ error: '请填写精修说明' }, { status: 400 });
      }
      const src = refImages?.[0];
      if (!src || !src.startsWith('data:image/')) {
        return NextResponse.json({ error: '精修需要一张原图，请先选择要精修的图片' }, { status: 400 });
      }
      const lang = promptLanguage === 'en' ? 'en' : 'zh';
      const composed = buildImageRefinePrompt(instr, lang);

      let dataUrl: string;
      if (provider === 'gemini') {
        const ai = createGeminiClient(apiKey);
        const imageModel = model || 'gemini-2.5-flash-image';
        dataUrl = await generateImageGemini(ai, imageModel, composed, src);
      } else {
        try {
          const client = createDetaler(apiKey);
          const parsed = parseImageDataUrl(src);
          const file = await toFile(parsed.buffer, 'refine.png', { type: parsed.mimeType });
          const rawRefine = (model || 'gpt-image-1').trim();
          const imageModel = resolveDetalerUpstreamModel(rawRefine);
          const edited = await client.images.edit({
            model: imageModel,
            image: file as any,
            prompt: composed,
            size: SIZE_MAP[size] || '1024x1024',
          } as any);
          const d = (edited as any)?.data?.[0];
          if (typeof d?.b64_json === 'string' && d.b64_json) {
            dataUrl = `data:image/png;base64,${d.b64_json}`;
          } else if (typeof d?.url === 'string' && d.url) {
            return NextResponse.json({ url: d.url });
          } else {
            throw new Error('Detaler 精修未返回图片');
          }
        } catch (err) {
          const base = err instanceof Error ? err.message : String(err);
          throw new Error(appendDetalerManualHint(base));
        }
      }
      const url = persistDataUrlAsPublicUrl(dataUrl);
      return NextResponse.json({ url });
    }

    if (!prompt?.trim()) {
      return NextResponse.json({ error: '缺少 prompt' }, { status: 400 });
    }
    if (provider === 'gemini') {
      const ai = createGeminiClient(apiKey);
      const imageModel = model || 'gemini-2.5-flash-image';
      const dataUrl = await generateImageGemini(ai, imageModel, prompt.trim(), refImages);
      const url = persistDataUrlAsPublicUrl(dataUrl);
      return NextResponse.json({ url });
    }
    if (provider === 'qwen') {
      if (refImages && refImages.length > 0) {
        return NextResponse.json(
          { error: '万相当前仅支持纯文生图；垫图生图请切换为 Gemini，或先根据产品信息生成 Prompt 再出图' },
          { status: 400 }
        );
      }
      const imageUrl = await wanxTextToImage(apiKey, model || 'wanx-v1', prompt.trim(), size);
      return NextResponse.json({ url: imageUrl });
    }
    if (provider === 'openrouter') {
      if (refImages && refImages.length > 0) {
        return NextResponse.json(
          { error: 'OpenRouter 生图当前仅支持文生图，不支持垫图输入。请去掉垫图后重试。' },
          { status: 400 }
        );
      }
      const dataUrl = await generateImageOpenRouter(apiKey, model || 'google/gemini-3.1-flash-image', prompt.trim());
      const url = persistDataUrlAsPublicUrl(dataUrl);
      return NextResponse.json({ url });
    }
    if (provider === 'detaler') {
      const rawModel = (model || 'gpt-image-1').trim();
      const selectedModel = normalizeDetalerModel(rawModel);
      const isExperimental = Object.prototype.hasOwnProperty.call(DETALER_EXPERIMENTAL_UPSTREAM, rawModel);
      if (!isExperimental && !DETALER_SUPPORTED_IMAGE_MODELS.has(selectedModel)) {
        return NextResponse.json(
          { error: `Detaler 当前仅支持以下生图模型：Nano Banana 2.0（实验）、ChatGPT Image 2.0、gpt-image-1、gpt-image-1.5。你当前选择的是：${model || selectedModel}` },
          { status: 400 }
        );
      }
      const upstreamModel = resolveDetalerUpstreamModel(rawModel);
      const worker = async () => {
        try {
          return await runDetalerGeneration({
            apiKey: apiKey.trim(),
            upstreamModel,
            prompt: prompt.trim(),
            size,
            refImages,
          });
        } catch (err) {
          const base = err instanceof Error ? err.message : String(err);
          throw new Error(appendDetalerManualHint(base));
        }
      };
      if (asyncMode) {
        const jobId = createImageJob(worker, {
          timeoutMs: DETALER_SINGLE_CALL_MS + 15_000,
          timeoutMessage: appendDetalerManualHint('Detaler 生成超时'),
        });
        return NextResponse.json({ jobId, status: 'pending' });
      }
      const url = await worker();
      return NextResponse.json({ url });
    }
    const openai = createOpenAI(apiKey);
    const sizeOption = SIZE_MAP[size] || '1024x1024';
    if (model?.startsWith('dall-e')) {
      const imageModel = model === 'dall-e-2' ? 'dall-e-2' : 'dall-e-3';
      const res = await openai.images.generate({
        model: imageModel,
        prompt,
        n: 1,
        size: imageModel === 'dall-e-3' ? sizeOption : '1024x1024',
        response_format: 'url',
        quality: 'standard',
      });
      const data = res.data?.[0];
      const url = data?.url;
      if (!url) return NextResponse.json({ error: '未返回图片' }, { status: 500 });
      return NextResponse.json({ url, data: res.data });
    }
    return NextResponse.json({ error: '当前仅支持 DALL-E 或 Gemini，请选择提供商' }, { status: 400 });
  } catch (e) {
    const elapsed = Date.now() - _reqStart;
    console.error(`[api/image/generate] 耗时 ${elapsed}ms`, e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/Connection error|ENOTFOUND|ECONNREFUSED|fetch failed/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            'Detaler 连接失败：当前 API 地址不可达。请提供 Detaler 官方 API 文档中的 Base URL（OpenAI 兼容地址），我来替你改为正确地址。',
        },
        { status: 502 }
      );
    }
    if (/User not found|401/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            'OpenRouter 认证失败（401: User not found）。请检查：1) Key 必须是 OpenRouter 的 sk-or- 开头；2) 没有多复制空格或换行；3) 该 key 在 OpenRouter 控制台仍有效；4) 账户有可用余额/额度。',
        },
        { status: 401 }
      );
    }
    if (/OpenRouter API Key 格式无效|OpenRouter API Key 未配置/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: formatUpstreamError(e, 'Gemini 生图') }, { status: 500 });
  }
}
