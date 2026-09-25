import { AuthGuard, LogoutButton } from '@qitu/auth';

export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGuard expectedRole="admin" redirectTo="/admin/login">
      <LogoutButton redirectTo="/admin/login" />
      {children}
    </AuthGuard>
  );
}
