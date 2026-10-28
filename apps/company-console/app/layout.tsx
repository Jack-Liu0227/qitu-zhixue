import type { Metadata } from 'next';
import './company.css';
export const metadata: Metadata = {
  title: '启途智学 · Company',
  description: '一人公司的经营与 Agent 团队工作台',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
