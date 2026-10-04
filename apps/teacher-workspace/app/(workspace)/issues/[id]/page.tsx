import { redirect } from 'next/navigation';

export default function IssueDetailPage() {
  // 问题处理当前以问题处理页的干预工作台呈现，本路由只做兼容跳转。
  //
  // `/issues` 是 basePath 相对路径，**不要**改成 `/teacher/issues`：
  // teacher app 的 `next.config.ts` 设了 `basePath: '/teacher'`，
  // `next/navigation` 的 `redirect()` 会自动补 basePath（底层
  // `addPathPrefix()` 只拼前缀、不去重），写成 `/teacher/issues` 会得到
  // `/teacher/teacher/issues` 并 404。
  // 回归检查：`node tooling/check-basepath.mjs`（已接入 CI）。
  redirect('/issues');
}
