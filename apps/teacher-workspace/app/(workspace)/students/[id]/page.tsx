import { redirect } from 'next/navigation';

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // 学生档案当前以学生管理页右侧的详情面板呈现，本路由只做兼容跳转。
  // Teacher app 使用 basePath=/teacher，redirect 目标必须包含 basePath，
  // 否则 Next 会把请求送到站点根路径 /students 并返回 404。
  const { id } = await params;
  redirect(`/teacher/students?studentId=${encodeURIComponent(id)}`);
}
