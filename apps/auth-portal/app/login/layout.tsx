import type { Metadata } from 'next';

/** 客户端登录页面的元数据由服务端布局提供。 */
export const metadata: Metadata = {
  title: '登录与注册',
  description:
    '启途智学统一身份入口：学生与家长可注册个人账号，学生、家长、班主任与管理员统一登录。',
};

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
