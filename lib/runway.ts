const RUNWAY_BASE = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION = '2024-11-06';

async function runwayFetch(
  apiKey: string,
  path: string,
  options: RequestInit = {}
) {
  const res = await fetch(`${RUNWAY_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'X-Runway-Version': RUNWAY_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res;
}

export async function createImageToVideoTask(
  apiKey: string,
  params: {
    promptImage: string;
    promptText: string;
    model?: string;
    ratio?: string;
    duration?: number;
  }
): Promise<{ id: string }> {
  const res = await runwayFetch(apiKey, '/image_to_video', {
    method: 'POST',
    body: JSON.stringify({
      model: params.model || 'gen3a_turbo',
      promptImage: params.promptImage,
      promptText: params.promptText || 'Product showcase, subtle motion, professional.',
      ratio: params.ratio || '1280:720',
      duration: params.duration ?? 5,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.error || `Runway error: ${res.status}`);
  return { id: data.id };
}

export async function createTextToVideoTask(
  apiKey: string,
  params: {
    promptText: string;
    model?: string;
    ratio?: string;
    duration?: number;
  }
): Promise<{ id: string }> {
  const res = await runwayFetch(apiKey, '/text_to_video', {
    method: 'POST',
    body: JSON.stringify({
      model: params.model || 'gen3a_turbo',
      promptText: params.promptText,
      ratio: params.ratio || '1280:720',
      duration: params.duration ?? 5,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.error || `Runway error: ${res.status}`);
  return { id: data.id };
}

export async function getTask(apiKey: string, taskId: string): Promise<{
  id: string;
  status: string;
  output?: string | { url?: string };
}> {
  const res = await runwayFetch(apiKey, `/tasks/${taskId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.error || `Runway error: ${res.status}`);
  return data;
}

export async function waitForTaskOutput(
  apiKey: string,
  taskId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<string> {
  const intervalMs = options.intervalMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 180000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await getTask(apiKey, taskId);
    if (task.status === 'SUCCEEDED') {
      const out = task.output;
      if (typeof out === 'string') return out;
      if (out && typeof out === 'object') {
        const o = out as { url?: string; output?: string | { url?: string } };
        if (o.url) return o.url;
        if (typeof o.output === 'string') return o.output;
        if (o.output?.url) return (o.output as { url: string }).url;
      }
      const t = task as { output?: string | { url?: string } | Array<{ url?: string }> };
      if (Array.isArray(t.output) && t.output[0]?.url) return t.output[0].url;
      throw new Error('任务成功但无输出 URL');
    }
    if (task.status === 'FAILED' || task.status === 'CANCELLED') {
      const fail = task as { failure?: string };
      throw new Error(fail.failure || `任务失败: ${task.status}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('等待视频生成超时');
}
