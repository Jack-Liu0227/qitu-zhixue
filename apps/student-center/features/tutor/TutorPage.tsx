'use client';

import { useState } from 'react';
import { PermissionDenied } from '@qitu/ui';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { ProjectContextPanel } from './components/ProjectContextPanel';
import { TutorHeader } from './components/TutorHeader';
import { TutorTeamRail } from './components/TutorTeamRail';
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

  const [activeSourceIndex, setActiveSourceIndex] = useState<number | null>(null);

  const sessionTitle = session.project?.project?.title ?? 'AI搭档启发探究对话';

  return (
    <div className="qitu-tutor-page">
      <TutorHeader />
      <div className="qitu-tutor-grid">
        <ProjectContextPanel
          status={session.projectStatus}
          project={session.project}
          error={session.projectError}
          offline={session.offline}
          permissionDenied={session.permissionDenied}
          onRetry={session.retryProject}
          onReconnect={session.reconnect}
          activeSourceIndex={activeSourceIndex}
          onSelectSource={(source) => {
            setActiveSourceIndex(source.index);
            composer.setDraft(
              composer.draft
                ? `${composer.draft} [${source.index}]`
                : `关于参考材料 [${source.index}] ${source.title}，我想请教：`,
            );
          }}
        />

        <ChatThread
          turns={session.turns}
          status={chatStatus}
          error={chatError}
          streaming={session.streaming}
          offline={session.offline}
          escalated={session.escalated}
          disabled={!sessionReady}
          sessionTitle={sessionTitle}
          sourceCount={6}
          onCitationClick={(index) => setActiveSourceIndex(index)}
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
        <TutorTeamRail
          streaming={session.streaming}
          ready={session.sessionStatus === 'ready'}
          failed={
            session.sessionStatus === 'error' ||
            session.submitError !== null ||
            session.streamNotice !== null
          }
          offline={session.offline}
        />
      </div>
    </div>
  );
}
