import { AuthGuard, LogoutButton } from '@qitu/auth';
import type { Metadata } from 'next';
import '@qitu/ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: '启途智学 · 班主任工作台',
  description: '启途智学班主任工作台',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthGuard expectedRole="teacher">
          <LogoutButton />
          {children}
        </AuthGuard>
      </body>
    </html>
  );
}
