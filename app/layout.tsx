import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '涌觉商贸AI图文视频制作工具',
  description: '产品解析、SEO 文案、场景图与短视频一站式生成',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen antialiased font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
