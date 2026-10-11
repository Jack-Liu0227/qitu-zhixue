'use client';

import { useState } from 'react';
import { PermissionDenied } from '@qitu/ui';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { PinnedSourcesRail } from './components/PinnedSourcesRail';
import { ProjectContextPanel } from './components/ProjectContextPanel';
import { TutorHeader } from './components/TutorHeader';
import { MOCK_PROJECT_CONTEXT } from './data/fixtures';
import { useComposer } from './hooks/useComposer';
import { useTutorSession } from './hooks/useTutorSession';
import type { TutorLoadStatus } from './types';

/**
 * 「AI搭档」统一对话页：左侧为项目/探索进度与固定资料，右侧为全宽智能对话工作区。
 * 项目阶段、探索状态、AI 决策、成长记录和审计均为服务端只读投影。
 */
export function TutorPage({ projectId }: { projectId?: string }) {
  const session = useTutorSession(projectId);
  const composer = useComposer();
  const [sidebarTab, setSidebarTab] = useState<'progress' | 'sources'>('progress');
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);

  if (session.permissionDenied) {
    return (
      <div className="qitu-tutor-page">
        <PermissionDenied
          title="无法进入 AI搭档"
          description="你没有访问这个会话的权限，请返回上一页。"
        />
      </div>
    );
  }

  const sessionReady = session.sessionId !== null && session.sessionStatus !== 'error';
  const chatStatus: TutorLoadStatus =
    session.sessionStatus === 'error' ||
    session.submitError !== null ||
    session.streamNotice !== null
      ? 'error'
      : session.turns.length > 0
        ? 'ready'
        : session.sessionStatus === 'loading'
          ? 'loading'
          : 'empty';
  const chatError = session.sessionError ?? session.submitError ?? session.streamNotice;

  const effectiveProject = session.project ?? MOCK_PROJECT_CONTEXT;
  const effectiveProjectStatus = session.projectStatus === 'error' ? 'error' : 'ready';

  return (
    <div className="qitu-tutor-page">
      <TutorHeader />
      <div className={`qitu-tutor-grid ${sourcesCollapsed ? 'is-sources-collapsed' : ''}`}>
        <aside className="qitu-tutor-pinned-sidebar" aria-label="项目进度与资料">
          <div className="qitu-tutor-sidebar-switch">
            <button
              type="button"
              className={`qitu-tutor-tab-btn ${sidebarTab === 'progress' ? 'is-active' : ''}`}
              onClick={() => { setSidebarTab('progress'); setSourcesCollapsed(false); }}
            >
              📊 项目进度
            </button>
            <button
              type="button"
              className={`qitu-tutor-tab-btn ${sidebarTab === 'sources' ? 'is-active' : ''}`}
              onClick={() => { setSidebarTab('sources'); setSourcesCollapsed(false); }}
            >
              ⌖ 固定资料
            </button>
            <button
              type="button"
              className="qitu-tutor-pinned-toggle"
              onClick={() => setSourcesCollapsed((current) => !current)}
              aria-expanded={!sourcesCollapsed}
              title={sourcesCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              <span aria-hidden="true">{sourcesCollapsed ? '›' : '‹'}</span>
            </button>
          </div>

          {sourcesCollapsed ? (
            <div className="qitu-tutor-pinned-collapsed" aria-hidden="true" onClick={() => setSourcesCollapsed(false)}>
              {sidebarTab === 'progress' ? '📊' : '⌖'}
            </div>
          ) : sidebarTab === 'progress' ? (
            <ProjectContextPanel
              status={effectiveProjectStatus}
              project={effectiveProject}
              error={session.projectError}
              offline={session.offline}
              permissionDenied={session.permissionDenied}
              onRetry={session.retryProject}
              onReconnect={session.reconnect}
            />
          ) : (
            <PinnedSourcesRail turns={session.turns} />
          )}
        </aside>
        <ChatThread
          turns={session.turns}
          status={chatStatus}
          error={chatError}
          streaming={session.streaming}
          offline={session.offline}
          escalated={session.escalated}
          disabled={!sessionReady}
          onRetry={session.retrySession}
          onReconnect={session.reconnect}
          onSelectOption={(label) => {
            void session.selectOption(label);
          }}
          composer={
            <Composer
              draft={composer.draft}
              onDraftChange={composer.setDraft}
              offline={session.offline}
              submitting={composer.submitting}
              disabled={!sessionReady}
              onSubmit={() => {
                void composer.submit(composer.draft, session.submitText);
              }}
            />
          }
        />
      </div>
    </div>
  );
}
