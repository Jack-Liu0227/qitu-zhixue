import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * 学生端内部链接。
 *
 * `next.config.ts` 里 `basePath: '/student'`，而 `next/link` 会**自动补** basePath。
 * 仓库里现存的 href 都是「已经带 /student 的完整外链路径」（例如 `/student/growth`
 * 或 `projectDetailHref()` 的返回值），直接交给 `next/link` 会变成
 * `/student/student/growth`。所以这里统一剥掉 basePath 前缀再交给 Link。
 *
 * 非 /student 开头的（外链、绝对 URL）原样透传。
 */
const BASE_PATH = '/student';

export function toAppHref(href: string): string {
  if (href === BASE_PATH) return '/';
  return href.startsWith(`${BASE_PATH}/`) ? href.slice(BASE_PATH.length) : href;
}

export function StudentLink({ href, ...rest }: ComponentProps<typeof Link>) {
  return <Link href={typeof href === 'string' ? toAppHref(href) : href} {...rest} />;
}
