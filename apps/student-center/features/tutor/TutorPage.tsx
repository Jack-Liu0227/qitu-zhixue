'use client';

import { useState } from 'react';
import { PermissionDenied } from '@qitu/ui';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { PinnedSourcesRail } from './components/PinnedSourcesRail';
import { TutorHeader } from './components/TutorHeader';
import { useComposer } from './hooks/useComposer';
import { useTutorSession } from './hooks/useTutorSession';
import type { TutorLoadStatus } from './types';

/**
 * 「AI搭档」统一对话页：左侧为项目/探索进度，中间为唯一对话区。
 * 项目阶段、探索状态、AI 决策、成长记录和审计均为服务端只读投影。
 */
export function TutorPage({ projectId }: { projectId?: string }) {
  const session = useTutorSession(projectId);
  const composer = useComposer();
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
  // A failed submission or a stream that reported a blocked/failed turn must
  // reach the student: `chatStatus` alone is driven by the session load, so
  // without this the error would be swallowed and the thread would look fine.
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

  return (
    <div className="qitu-tutor-page">
      <TutorHeader />
      <div className={`qitu-tutor-grid ${sourcesCollapsed ? 'is-sources-collapsed' : ''}`}>
        <aside className="qitu-tutor-pinned-sidebar" aria-label="固定资料">
          <button type="button" className="qitu-tutor-pinned-toggle" onClick={() => setSourcesCollapsed((current) => !current)} aria-expanded={!sourcesCollapsed} aria-label={sourcesCollapsed ? '展开固定资料' : '收起固定资料'} title={sourcesCollapsed ? '展开固定资料' : '收起固定资料'}>
            <span aria-hidden="true">{sourcesCollapsed ? '›' : '‹'}</span>
            <span>{sourcesCollapsed ? '资料' : '收起'}</span>
          </button>
          {sourcesCollapsed ? <div className="qitu-tutor-pinned-collapsed" aria-hidden="true">⌖</div> : <PinnedSourcesRail turns={session.turns} />}
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
