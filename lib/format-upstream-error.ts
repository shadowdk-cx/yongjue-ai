/** 把 SDK / Node fetch 抛出的错误整理成可读文案，并补充网络类问题的排查提示 */

function collectMessages(e: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (e instanceof Error) {
    const out = [e.message].filter(Boolean) as string[];
    const c = (e as Error & { cause?: unknown }).cause;
    if (c !== undefined && c !== null) out.push(...collectMessages(c, depth + 1));
    return out;
  }
  if (e != null && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string' && m) return [m];
  }
  if (typeof e === 'string' && e) return [e];
  return [];
}

export function formatUpstreamError(e: unknown, context: string): string {
  const parts = collectMessages(e).filter(Boolean);
  const combined = parts.join(' — ') || '请求失败';
  const any = e as Error & { status?: number };
  let msg = combined;
  if (typeof any.status === 'number' && any.status > 0) {
    msg = `${msg}（HTTP ${any.status}）`;
  }

  const looksNetwork =
    /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|certificate|socket|TLS|SSL|getaddrinfo|UND_ERR_CONNECT_TIMEOUT|Connect Timeout|network/i.test(
      combined
    );

  if (looksNetwork) {
    msg += ` 【${context}】这通常是本机连不上 Google（Gemini）服务器：国内网络或未开代理时很常见。请尝试：① 开启合规 VPN 或系统代理后，关掉终端再重新运行启动命令；② 在启动前执行 export HTTPS_PROXY=http://127.0.0.1:7890（端口改成你代理软件本地端口）；③ 确认 API Key 在 Google AI Studio 有效。`;
  }

  const looksTooLarge =
    (typeof any.status === 'number' && any.status === 413) ||
    /413|payload too large|request entity too large|body exceeded|max body/i.test(combined);
  if (looksTooLarge) {
    msg += ` 【${context}】请求体过大：请减少垫图数量、使用更小图片，或确认 Zeabur/反代是否限制上传体积（常见默认 1～8MB）。`;
  }

  return msg;
}
