import type { Metadata } from 'next';
import '@qitu/ui/styles.css';
import './globals.css';
import './home.css';

export const metadata: Metadata = {
  title: {
    default: '启途智学 · AI 驱动的项目式学习平台',
    template: '%s · 启途智学',
  },
  description:
    '启途智学是面向中小学的项目式 AI 学习平台：AI 搭档启发式引导、先理论后实践、作品与成长档案全程沉淀。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
