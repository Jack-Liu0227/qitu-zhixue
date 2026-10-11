'use client';

import { PermissionDenied } from '@qitu/ui';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { TutorHeader } from './components/TutorHeader';
import { useComposer } from './hooks/useComposer';
import { useTutorSession } from './hooks/useTutorSession';
import type { TutorLoadStatus } from './types';

/** AI 搭档主对话工作区：项目进度和固定资料不在此页面展示。 */
export function TutorPage({ projectId }: { projectId?: string }) {
  const session = useTutorSession(projectId);
  const composer = useComposer();

  if (session.permissionDenied) {
    return (
      <div className="qitu-tutor-page">
        <PermissionDenied title="无法进入 AI搭档" description="你没有访问这个会话的权限，请返回上一页。" />
      </div>
    );
  }

  const sessionReady = session.sessionId !== null && session.sessionStatus !== 'error';
  const chatStatus: TutorLoadStatus =
    session.sessionStatus === 'error' || session.submitError !== null || session.streamNotice !== null
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
      <div className="qitu-tutor-grid qitu-tutor-grid-full-chat">
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
          onSelectOption={(label) => { void session.selectOption(label); }}
          composer={(
            <Composer
              draft={composer.draft}
              onDraftChange={composer.setDraft}
              offline={session.offline}
              submitting={composer.submitting}
              disabled={!sessionReady}
              onSubmit={() => { void composer.submit(composer.draft, session.submitText); }}
            />
          )}
        />
      </div>
    </div>
  );
}
