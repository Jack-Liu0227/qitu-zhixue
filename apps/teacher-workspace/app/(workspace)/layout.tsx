import { AuthGuard } from '@qitu/auth';
import { TeacherShell } from '../../components/teacher-shell';

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGuard expectedRole="teacher">
      <TeacherShell>{children}</TeacherShell>
    </AuthGuard>
  );
}
