'use client';

import { InspirationTabs } from '../../features/inspiration';

/**
 * `/student/inspiration` — 灵感空间。
 *
 * 双标签页：推荐项目（默认）/ 自由探索。推荐项目点击后进入既有的
 * 探索确认流程 `/student/inspiration/explore/<sessionId>`，不直接创建项目。
 */
export default function InspirationRoute() {
  return <InspirationTabs />;
}
