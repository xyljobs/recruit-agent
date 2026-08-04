import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '智聘Agent | 人才智能匹配系统',
    template: '%s | 智聘Agent',
  },
  description:
    '智聘Agent是一款AI驱动的人才智能匹配系统，帮助HR高效完成JD解析、候选人匹配、智能话术生成和状态跟进管理。',
  keywords: [
    '智聘Agent',
    '人才匹配',
    'AI招聘',
    '智能招聘',
    'HR系统',
    '候选人管理',
  ],
  authors: [{ name: '智聘Agent Team' }],
  generator: 'Next.js',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <html lang="zh-CN">
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
