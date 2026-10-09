import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '../home/icons';

/**
 * `/login` 的布局。
 *
 * 登录页是客户端组件，**不能**自己导出 `metadata`，所以标题放在这一层。
 * 这里同时提供「返回首页」入口：登录页从 `/` 拆出来之后不能再是孤岛。
 */
export const metadata: Metadata = {
  title: '统一登录',
  description: '启途智学统一身份入口：学生、家长、班主任与管理员使用同一入口登录。',
};

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Link className="login-back" href="/">
        <Icon name="arrowRight" size={16} />
        返回首页
      </Link>
      {children}
    </>
  );
}
