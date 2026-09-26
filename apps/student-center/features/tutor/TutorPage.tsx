'use client';

import { PermissionDenied } from '@qitu/ui';
import { CapabilityRail } from './components/CapabilityRail';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { ProjectContextPanel } from './components/ProjectContextPanel';
import { useCapabilityInvoke } from './hooks/useCapabilityInvoke';
import { useComposer } from './hooks/useComposer';
import { useTutorSession } from './hooks/useTutorSession';
import type { TutorLoadStatus } from './types';

/**
 * 「AI搭档」 route shell: left = project context, center = conversation,
 * right = the six capability entries.
 *
 * It resolves the optional `:projectId` and owns nothing that the server owns:
 * project stage, AI decisions, growth records and audit events are read-only
 * projections here. Route wiring (app/student/tutor/…) is Wave 4's job; this
 * component only needs the resolved `projectId`.
 */
export function TutorPage({ projectId }: { projectId?: string }) {
  const session = useTutorSession(projectId);
  const composer = useComposer();
  const capability = useCapabilityInvoke(session.invokeCapability);

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
      <div className="qitu-tutor-grid">
        <ProjectContextPanel
          status={session.projectStatus}
          project={session.project}
          error={session.projectError}
          offline={session.offline}
          permissionDenied={session.permissionDenied}
          onRetry={session.retryProject}
          onReconnect={session.reconnect}
        />

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
              onAudio={() => {
                // Voice shell: the audio Blob is handed over in memory only and
                // is never persisted. ASR/TTS is out of this module's scope.
              }}
            />
          }
        />

        <CapabilityRail
          sessionReady={sessionReady}
          lastHintLevel={session.lastHintLevel}
          guidanceRun={session.guidanceRun}
          pendingMove={capability.pendingMove}
          onInvoke={(move) => {
            void capability.invokeMove(move);
          }}
        />
      </div>
    </div>
  );
}
