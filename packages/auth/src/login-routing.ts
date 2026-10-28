import type { Role } from '@qitu/contracts';

export function roleHome(role: Role): string {
  return ({ student: '/student/today', teacher: '/teacher/dashboard', parent: '/parent', admin: '/admin', support: '/' })[role];
}

export function safeRoleDestination(raw: string | null, role: Role): string {
  const fallback = roleHome(role);
  if (!raw || !raw.startsWith('/') || /[\\\u0000-\u0020]/.test(raw) || raw.startsWith('//')) return fallback;
  try {
    const target = new URL(raw, 'https://qitu.invalid');
    const prefix = `/${role}`;
    if (target.origin === 'https://qitu.invalid' && (target.pathname === '/company' || target.pathname.startsWith('/company/'))) return `${target.pathname}${target.search}${target.hash}`;
    if (target.origin !== 'https://qitu.invalid' || (target.pathname !== prefix && !target.pathname.startsWith(`${prefix}/`))) return fallback;
    if (target.pathname === `${prefix}/login`) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return fallback; }
}

export function loginHref(role: Role, target: string, reason?: string): string {
  const query = new URLSearchParams({ role, next: safeRoleDestination(target, role) });
  if (reason) query.set('reason', reason);
  return `/login?${query}`;
}
