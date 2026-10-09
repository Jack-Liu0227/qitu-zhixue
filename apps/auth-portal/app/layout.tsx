import type { Metadata } from 'next';
import '@qitu/ui/styles.css';
import './globals.css';
import './home-design.css';
import './login.css';

export const metadata: Metadata = {
  title: '启途智学 · AI 个性化项目学习平台',
  description: '启途智学，AI 驱动的个性化项目学习平台。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
