import { redirect } from 'next/navigation';

export default function StudentDetailPage() {
  // 初版学生档案以 /teacher/students 右侧详情面板呈现，后续 P2 再独立为全页档案。
  redirect('/students');
}
