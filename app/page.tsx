import dynamic from 'next/dynamic';

/**
 * 生产环境 next start 下整页 SSR 偶发白屏：主界面仅在浏览器挂载（ssr:false），
 * 服务端只输出下方 loading，避免大体积 Client 组件在服务端渲染阶段异常。
 */
const HomeFull = dynamic(() => import('@/components/HomeFull'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 text-slate-600 px-6">
      <p className="text-base font-medium text-slate-800">正在加载工具…</p>
      <p className="text-sm text-center max-w-md">
        若一直停在此页，请按键盘 <kbd className="px-1 rounded bg-slate-200 text-slate-800">F12</kbd> 或
        <kbd className="px-1 rounded bg-slate-200 text-slate-800">⌥⌘I</kbd> 打开开发者工具 → 点「Console」查看红色报错。
      </p>
    </div>
  ),
});

export default function Page() {
  return <HomeFull />;
}
