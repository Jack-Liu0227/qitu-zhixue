import type { Metadata } from 'next';
import '@qitu/ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: '启途智学 · 家长陪伴中心',
  description: '启途智学家长陪伴中心',
};

/**
 * 根布局只负责 html/body 与样式，不做登录守卫。
 *
 * 守卫放在 `(protected)/layout.tsx`：这样 `/parent/login` 可以在未登录时被访问，
 * 不会出现「登录页自己要求先登录」的死循环。所有家长功能页都放在 `(protected)`
 * 路由组内，进入前必须通过 `AuthGuard expectedRole="parent"`。
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
