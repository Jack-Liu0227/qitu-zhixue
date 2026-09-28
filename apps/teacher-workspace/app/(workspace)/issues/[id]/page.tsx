import { redirect } from 'next/navigation';

export default function IssueDetailPage() {
  // 问题处理当前以问题处理页的干预工作台呈现，本路由只做兼容跳转。
  redirect('/issues');
}
