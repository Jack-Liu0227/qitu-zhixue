import { redirect } from 'next/navigation';

/**
 * 遗留书签兼容：模型页已并入供应商工作区，不再维护第二份模型清单。
 *
 * `next.config.ts` 设置了 `basePath: '/admin'`，而 `next/navigation` 的
 * `redirect()` 会**自动补上 basePath**，因此这里必须写 basePath 相对路径；
 * 写成 `/admin/settings/model-providers` 会落到 `/admin/admin/...`（404）。
 *
 * 事实源：docs/admin/platform-governance.md、docs/admin/model-registry.md。
 */
export default function LegacyModelsRedirectPage() {
  redirect('/settings/model-providers');
}
