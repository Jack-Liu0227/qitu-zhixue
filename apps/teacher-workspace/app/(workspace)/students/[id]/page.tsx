import { redirect } from 'next/navigation';

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // 学生档案当前以学生管理页右侧的详情面板呈现，本路由只做兼容跳转。
  //
  // basePath 约定（重要）：
  // teacher app 的 `next.config.ts` 设了 `basePath: '/teacher'`，而
  // `next/navigation` 的 `redirect()` 会在客户端经 `addBasePath()` 自动补上
  // basePath（其底层 `addPathPrefix()` 只是拼前缀，**不做去重**）。
  // 因此这里必须传 basePath 相对路径 `/students`；传 `/teacher/students`
  // 会被拼成 `/teacher/teacher/students` 并 404。
  //
  // 与 `apps/student-center/app/page.tsx` 的说明保持一致。
  const { id } = await params;
  redirect(`/students?studentId=${encodeURIComponent(id)}`);
}
