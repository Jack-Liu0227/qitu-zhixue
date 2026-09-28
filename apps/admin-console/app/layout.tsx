import type { Metadata } from 'next';
import '@qitu/ui/styles.css';
import '@qitu/ui/preferences.css';
import './globals.css';

export const metadata: Metadata = {
  title: '启途智学 · 平台管理后台',
  description: '启途智学平台管理后台',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
