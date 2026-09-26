import { redirect } from 'next/navigation';

export default function IssueDetailPage() {
  // 初版问题处理以 /teacher/issues 的干预工作台呈现，后续 P2 再独立为全页详情。
  redirect('/issues');
}
