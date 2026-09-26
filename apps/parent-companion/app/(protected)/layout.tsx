'use client';
import { ParentShell } from '../../features/ParentShell';
export default function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ParentShell>{children}</ParentShell>;
}
