'use client';

import { AuthGuard } from '@qitu/auth';
import { ParentPortalShell } from '../../features/portal';

const PARENT_LOGIN_HREF = '/parent/login';

/**
 * 家长端受保护路由组的守卫布局。
 *
 * `expectedRole="parent"` 保证只有家长账号能进入。非家长账号（学生 / 班主任 /
 * 管理员）会被服务端 `/api/v1/auth/me` 判定为角色不匹配，这里通过
 * `onUnauthenticated` 在跳转前留下标记，让登录页展示「没有访问权限」的明确
 * 提示，而不是静默地再次跳走。
 */
export default function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGuard
      expectedRole="parent"
      redirectTo={PARENT_LOGIN_HREF}
      onUnauthenticated={(reason) => {
        if (reason === 'forbidden' || reason === 'expired') {
          window.sessionStorage.setItem('qitu.parent.auth.redirect', reason);
        }
      }}
    >
      <ParentPortalShell>{children}</ParentPortalShell>
    </AuthGuard>
  );
}
