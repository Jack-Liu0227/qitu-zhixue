import type { Metadata } from 'next';
import '@qitu/ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: '启途智学 · 学生学习中心',
  description: '启途智学学生学习中心',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
