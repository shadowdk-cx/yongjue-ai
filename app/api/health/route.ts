import { NextResponse } from 'next/server';

export async function GET() {
  const results: Record<string, unknown> = {
    ok: true,
    time: new Date().toISOString(),
    nodeVersion: process.version,
    port: process.env.PORT || '(未设置，默认 3000)',
    env: {
      NODE_ENV: process.env.NODE_ENV,
      TZ: process.env.TZ || '(未设置)',
    },
  };

  const t0 = Date.now();
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/', {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    });
    results.geminiReachable = true;
    results.geminiStatus = res.status;
    results.geminiLatencyMs = Date.now() - t0;
  } catch (e) {
    results.geminiReachable = false;
    results.geminiError = e instanceof Error ? e.message : String(e);
    results.geminiLatencyMs = Date.now() - t0;
  }

  return NextResponse.json(results);
}
