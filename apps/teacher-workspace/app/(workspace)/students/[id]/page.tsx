import { redirect } from 'next/navigation';

export default function StudentDetailPage() {
  // 学生档案当前以学生管理页右侧的详情面板呈现，本路由只做兼容跳转。
  redirect('/students');
}
