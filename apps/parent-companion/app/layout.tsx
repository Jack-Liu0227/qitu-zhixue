import { AuthGuard, LogoutButton } from '@qitu/auth';
import type { Metadata } from 'next';
import '@qitu/ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: '启途智学 · 家长陪伴中心',
  description: '启途智学家长陪伴中心',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthGuard expectedRole="parent">
          <LogoutButton />
          {children}
        </AuthGuard>
      </body>
    </html>
  );
}
