import dynamic from 'next/dynamic';

/**
 * 生产环境 next start 下整页 SSR 偶发白屏：主界面仅在浏览器挂载（ssr:false），
 * 服务端只输出下方 loading，避免大体积 Client 组件在服务端渲染阶段异常。
 */
const HomeFull = dynamic(() => import('@/components/HomeFull'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 text-slate-600 px-6">
      <p className="text-base font-medium text-slate-800">Loading… / 正在加载…</p>
      <p className="text-sm text-center max-w-md">
        If stuck, press <kbd className="px-1 rounded bg-slate-200 text-slate-800">F12</kbd> or
        <kbd className="px-1 rounded bg-slate-200 text-slate-800">⌥⌘I</kbd> to open DevTools → Console.
      </p>
    </div>
  ),
});

export default function Page() {
  return <HomeFull />;
}
