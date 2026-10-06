import type { CSSProperties, ReactNode } from 'react';

export function AppShell({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <main className="qitu-shell" style={{ '--qitu-accent': accent } as CSSProperties}>
      <header className="qitu-topbar">
        <strong>启途智学</strong>
        <span>{title}</span>
      </header>
      <div className="qitu-content">{children}</div>
    </main>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="qitu-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export * from './shell';
export * from './primitives';
export * from './states';
export * from './team';
