import { AuthGuard, LogoutButton } from '@qitu/auth';
import type { Metadata } from 'next';
import '@qitu/ui/styles.css';
import './globals.css';
// 学生端各功能模块自己的样式（每个模块一个文件，放在 apps/student-center/styles/）。
// 共用组件与设计令牌在 `@qitu/ui/styles.css`；这里只放 `qitu-<模块>-*` 这类模块专属类。
// AI搭档（tutor）的样式仍在 `@qitu/ui/styles.css` 里，暂未按模块拆出。
import '../styles/growth.css';
import '../styles/inspiration.css';
import '../styles/projects.css';
import '../styles/today.css';
import '../styles/voice.css';
import '../styles/workbench.css';
import { StudentShellHost } from './student-shell';

export const metadata: Metadata = {
  title: '启途智学 · 学生学习中心',
  description: '启途智学学生学习中心',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <AuthGuard expectedRole="student">
          <LogoutButton />
          <StudentShellHost>{children}</StudentShellHost>
        </AuthGuard>
      </body>
    </html>
  );
}
