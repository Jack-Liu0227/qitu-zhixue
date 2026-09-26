'use client';

import { SectionCard } from '@qitu/ui';

import { StudentLink } from '../../../components/student-link';

/** 自由探索保留已有入口：`/student/inspiration/explore/demo-session`。 */
export const FREE_EXPLORE_SESSION_ID = 'demo-session';

export function freeExploreHref(sessionId: string): string {
  return `/student/inspiration/explore/${sessionId}`;
}

/**
 * 「自由探索」标签页：保留既有的探索入口，不新建第二条确认流程。
 * 探索不会创建正式项目（AGENTS.md：学生未确认意图时不得创建正式项目）。
 */
export function FreeExplorePanel() {
  return (
    <SectionCard title="自由探索">
      <div className="qitu-inspiration-free-explore">
        <p className="qitu-inspiration-free-explore-description">
          还没想好做什么？和 AI搭档聊一聊你感兴趣的事，它会一步步帮你把想法说清楚。
        </p>
        <StudentLink
          className="qitu-button qitu-button-primary"
          href={freeExploreHref(FREE_EXPLORE_SESSION_ID)}
        >
          开始自由探索
        </StudentLink>
        <p className="qitu-inspiration-free-explore-hint">
          探索不会创建正式项目，确认想法后才会进入学习计划。
        </p>
      </div>
    </SectionCard>
  );
}
