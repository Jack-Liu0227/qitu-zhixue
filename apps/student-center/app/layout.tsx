import { AuthGuard } from '@qitu/auth';
import type { Metadata } from 'next';
import '@qitu/ui/styles.css';
import '@qitu/ui/preferences.css';
import './globals.css';
// AI搭档页的伙伴外壳样式放在 student-center，避免影响工作台共用的 tutor advice 组件。
import '../styles/growth.css';
import '../styles/inspiration.css';
import '../styles/projects.css';
import '../styles/today.css';
import '../styles/tutor.css';
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
          <StudentShellHost>{children}</StudentShellHost>
        </AuthGuard>
      </body>
    </html>
  );
}
