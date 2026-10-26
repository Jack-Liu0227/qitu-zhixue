'use client';

import { VisualAsset, ResizablePanels } from '@qitu/ui';

import { AssistantGlyph, ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock } from '@qitu/ui';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { TutorTeamGraph } from '@qitu/contracts';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { ProjectCard } from './components/ProjectCard';
import { CurrentTask } from './components/CurrentTask';
import { TutorSessionHistory } from './components/TutorSessionHistory';
import { TeamAgentHud } from './components/TeamAgentHud';
import { CurrentLessonCard } from './components/CurrentLessonCard';
import { LessonLearningDock, LessonTeachingWorkspace } from './components/LessonLearningDock';
import { ProjectLearningHistory } from './components/ProjectLearningHistory';
import { savedExperimentLinks } from './lib/timelinePresentation';
import { useComposer } from './hooks/useComposer';
import { useTutorViewport } from './hooks/useTutorViewport';
import { useTutorSession } from './hooks/useTutorSession';
import { useTutorTeamGraph } from './hooks/useTutorTeamGraph';
import { ExplorationProgressPanel } from './components/ExplorationProgressPanel';
import { useTutorDataSource } from './TutorDataSourceProvider';
import { createIdempotencyKey } from './idempotency';
import { getStoredEyecare, setStoredEyecare, subscribeEyecare } from './lib/eyecareStorage';
import type { TutorLoadStatus, TutorViewError } from './types';

/** Teaching state and gate decisions come only from the owned server session. */
export function TutorPage({ projectId }: { projectId?: string }) {
  useTutorViewport();
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = useTutorDataSource();
  const loadTeamHistory = useCallback((assistantId: string, cursor?: string) => {
    if (!projectId || !source.getTeamHistory) return Promise.reject(new Error('团队历史暂不可用'));
    return source.getTeamHistory(projectId, assistantId, cursor);
  }, [source, projectId]);
  const [explorationKey, setExplorationKey] = useState(0);
  const routeContextKey = searchParams.toString();
  const session = useTutorSession(projectId, explorationKey, searchParams.get('explorationId') || undefined);
  const composer = useComposer();
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [lessonWorkOpen, setLessonWorkOpen] = useState(false);
  useEffect(() => { setLessonWorkOpen(false); }, [projectId, session.project?.lesson?.learningSessionId]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1600px)');
    const syncPanels = () => {
      setLeftOpen(!query.matches);
      setRightOpen(!query.matches);
    };
    syncPanels();
    query.addEventListener('change', syncPanels);
    return () => query.removeEventListener('change', syncPanels);
  }, []);
  const [rightSidebarTab, setRightSidebarTab] = useState<'progress' | 'agents'>('progress');
  const { graph: teamGraph, status: teamGraphStatus, error: teamGraphError, retry: retryTeamGraph } = useTutorTeamGraph({
    source, projectId: projectId ?? session.project?.project?.id, explorationId: session.explorationId,
    refreshKey: session.turns.length, watch: rightOpen && rightSidebarTab === 'agents',
  });
  const [eyecareActive, setEyecareActive] = useState(false);

  useEffect(() => {
    setEyecareActive(getStoredEyecare());
    return subscribeEyecare((active) => {
      setEyecareActive(active);
    });
  }, []);

  const toggleEyecare = () => {
    setEyecareActive((prev) => {
      const next = !prev;
      setStoredEyecare(next);
      return next;
    });
  };
  const [confirming, setConfirming] = useState(false);
  const centerColumnRef = useRef<HTMLDivElement | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const confirmKey = useRef<{ explorationId: string; templateVersionId: string; key: string } | null>(null);

  function toggleHistory() {
    if (!leftOpen && window.matchMedia('(max-width: 768px)').matches) setRightOpen(false);
    setLeftOpen(!leftOpen);
  }

  function toggleContext() {
    if (!rightOpen && window.matchMedia('(max-width: 768px)').matches) setLeftOpen(false);
    setRightOpen(!rightOpen);
  }

  const team = session.project?.team;
  /** 探索会话为 null；只有真实项目才能拉知识库与进度。 */
  const projectSummary = session.project?.project ?? null;
  const servingAssistantName = team?.assistantName ?? '启途智学助手';
  const currentAssistantName = team?.teamName ?? servingAssistantName;
  const currentIdentityName = currentAssistantName;
  const ready = session.canStartExploration || session.sessionStatus === 'ready' && session.connection === 'open';
  const busy = session.streaming || session.submitting || composer.submitting;

  useEffect(() => {
    try {
      for (const key of ['qitu.tutor.sessions', 'qitu.llm.client_config', 'qitu.cached_configured_models']) localStorage.removeItem(key);
    } catch { /* Storage can be disabled; teaching does not depend on it. */ }
    const params = new URLSearchParams(routeContextKey);
    const prompt = params.get('explorePrompt');
    if (prompt) composer.setDraft(prompt);
  }, [composer.setDraft, routeContextKey]);

  const error = session.submitError ?? session.streamNotice ?? (confirmationError ? { message: confirmationError } : null);

  async function handleOneClickCreateProject(goal: string, interest: string, templateVersionId: string) {
    if (!session.explorationId || !source.confirmExploration || confirming || !templateVersionId.trim()) return;
    setConfirming(true);
    setConfirmationError(null);
    if (confirmKey.current?.explorationId !== session.explorationId || confirmKey.current.templateVersionId !== templateVersionId) {
      confirmKey.current = { explorationId: session.explorationId, templateVersionId, key: createIdempotencyKey() };
    }
    try {
      const result = await source.confirmExploration(
        session.explorationId,
        { goal: goal.trim(), interest: interest.trim(), templateVersionId },
        confirmKey.current.key,
      );
      router.push(`/tutor/${encodeURIComponent(result.project.id)}`);
    } catch (cause) {
      setConfirmationError(cause instanceof Error ? cause.message : '确认创建失败，请重试');
    } finally {
      setConfirming(false);
    }
  }

  function newExploration() {
    if (busy || confirming) return;
    if (projectId) { composer.clear(); router.push('/tutor?new=1', { scroll: false }); return; }
    window.history.replaceState(null, '', `${window.location.pathname}?new=1`);
    confirmKey.current = null;
    setConfirmationError(null);
    composer.clear();
    setExplorationKey((key) => key + 1);
  }

  if (session.permissionDenied) return <PermissionDenied title="无法进入 AI搭档" description="你没有访问这个会话的权限，请返回上一页。" />;

  return <div className="qitu-tutor-page" data-eyecare={eyecareActive ? 'active' : 'inactive'}>
    <header className="qitu-tutor-header">
      <div className="qitu-tutor-header-copy">
        <p className="qitu-tutor-eyebrow">启途智学 · 项目式学习</p>
        <div className="qitu-tutor-title-row">
          <h1>AI搭档</h1>
          <span className={`qitu-tutor-identity-badge ${team?.teamName ? 'is-team' : 'is-assistant'}`}>
            <span aria-hidden="true"><AssistantGlyph value={team?.assistantAvatar ?? (team?.teamName ? "👥" : null)} size={20} /></span>
            <span title={currentIdentityName}>{currentIdentityName}</span>
          </span>
        </div>
        <p className="qitu-tutor-header-subtitle">
          {team?.teamName
            ? `已由专属导师团队【${team.teamName}】接管辅导；当前发言助手为${servingAssistantName}。`
            : '由「启途智学助手」接管初步对话，确认意图后推荐项目，一键立项并唤醒导师团队。'}
        </p>
      </div>
      <div className="qitu-tutor-header-actions">
        <span role="status">
          {session.offline
            ? '离线 · 暂停发送'
            : session.sessionStatus === 'error'
              ? session.sessionError?.status === 401 ? '登录已失效' : '会话加载失败'
              : busy ? '导师正在处理' : session.canStartExploration ? '发送第一句话，开启探索' : ready ? '教学会话已连接' : '正在连接教学会话'}
        </span>
        <button
          type="button"
          className={`qitu-eyecare-toggle-btn ${eyecareActive ? 'is-active' : ''}`}
          onClick={toggleEyecare}
          aria-pressed={eyecareActive}
          title={eyecareActive ? '点击退出夜间模式' : '点击开启夜间模式 (2700K~3200K 柔光低眩光)'}
        >
          <span className="qitu-eyecare-btn-icon">🌙</span>
          <span className="qitu-eyecare-btn-text">
            {eyecareActive ? '夜间模式 (已开启)' : '夜间模式'}
          </span>
          {eyecareActive && <span className="qitu-eyecare-pulse-dot" aria-hidden="true" />}
        </button>

        <button
          type="button"
          className={`qitu-button qitu-button-ghost qitu-tutor-panel-toggle-btn ${rightOpen ? 'is-active' : ''}`}
          onClick={toggleContext}
          aria-expanded={rightOpen}
          title={rightOpen ? '收起右侧项目与进度' : '展开右侧项目与进度'}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="18" x="3" y="3" rx="4" />
            <path d="M15 3v18" />
            {rightOpen ? <path d="m8 9 3 3-3 3" /> : <path d="m11 15-3-3 3-3" />}
          </svg>
          <span>项目与进度</span>
        </button>
      </div>
    </header>
    <ResizablePanels storageKey="student-tutor" className="qitu-tutor-workspace-layout"
      initialSizes={leftOpen ? [20, 52, 28] : [1, 64, 36]} minWidths={[220, 400, 320]}
      fixedWidths={[leftOpen ? null : 56, null, null]} labels={['会话记录', 'AI搭档对话', '项目进度']}>
      <TutorSessionHistory
        isOpen={leftOpen}
        onToggle={toggleHistory}
        currentProjectId={projectId}
        currentExplorationId={session.explorationId}
        currentTitle={projectSummary?.title ?? session.project?.exploration?.title}
        currentAssistantName={currentAssistantName}
        currentTurnCount={session.turns.length}
        busy={busy || confirming}
        onNewExploration={newExploration}
        onSelectProject={(targetProjectId) => {
          if (busy || confirming) return;
          router.push(`/tutor/${encodeURIComponent(targetProjectId)}`, { scroll: false });
        }}
      />
      <div className="qitu-tutor-center-column" ref={centerColumnRef}>
        {session.projectRefreshError ? <div role="alert" className="qitu-tutor-inline-alert">
          {session.projectRefreshError.message}<button type="button" onClick={() => { void session.refreshProjectContext(); }}>重新读取课时</button>
        </div> : null}
        {error ? <div role="alert" className="qitu-tutor-inline-alert">{error.message} {error.code ? `（${error.code}）` : ''}<button type="button" onClick={session.dismissStreamNotice}>关闭提示</button></div> : null}
        <ChatThread
          sessionId={session.sessionId}
          turns={session.turns}
          currentAssistantName={currentAssistantName}
          explorationContext={session.project?.exploration ? session.project : undefined}
          idle={session.canStartExploration}
          status={session.sessionStatus === 'ready' && session.turns.length === 0 ? 'empty' : session.sessionStatus}
          error={session.sessionError}
          streaming={session.streaming}
          offline={session.offline}
          escalated={session.escalated}
          disabled={!ready || busy || confirming}
          onRetry={session.projectStatus === 'error' ? session.retryProject : session.retrySession}
          onNewExploration={newExploration}
          onReconnect={session.reconnect}
          onPrepareDraft={(text) => {
            if (!ready || busy || confirming || session.offline) return;
            if (text) composer.setDraft(text);
            centerColumnRef.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入你的想法"]')?.focus({ preventScroll: true });
          }}
          onSelectOption={(label, text) => {
            if (!ready || busy || confirming) return;
            if (text) void composer.submit(text, session.submitText);
            else void session.selectOption(label).catch(() => undefined);
          }}
          onSubmitQuestionAnswer={(answer) => {
            if (!ready || busy || confirming || session.offline) return;
            void composer.submit(answer, session.submitText);
          }}
          onOneClickCreateProject={handleOneClickCreateProject}
          onAnswerQuiz={(quizId, selectedKeys, idempotencyKey) => session.answerQuiz(quizId, selectedKeys, idempotencyKey)}
          onRequestQuizExplanation={(quizId) => session.explainQuiz(quizId)}
          onExperimentAction={(experimentId, action, payload, idempotencyKey) => session.submitExperimentAction(experimentId, { action, payload, idempotencyKey })}
          onFeedback={(turnId, kind, idempotencyKey) => session.submitFeedback({ turnId, kind, idempotencyKey })}
          projectId={projectSummary?.id ?? projectId ?? null}
          coursewareSnapshots={session.project?.lesson?.teachingMode === 'zero-base.v1'}
          projectContext={session.project ?? undefined}
          learningActivity={projectSummary && session.project?.lesson?.status === 'current' ? <LessonTeachingWorkspace
            projectId={projectSummary.id} lesson={session.project.lesson} refreshKey={session.project}
            disabled={!ready || busy || confirming || session.offline} onChanged={session.refreshProjectContext}
            onOpenRecords={() => {
              if (window.matchMedia('(max-width: 768px)').matches) setLeftOpen(false);
              setRightOpen(true); setRightSidebarTab('progress'); setLessonWorkOpen(true);
            }}
            onExplain={message => { void composer.submit(message, session.submitText); }} /> : null}
          isConfirmingProject={confirming}
          composer={
            <Composer
              draft={composer.draft}
              onDraftChange={composer.setDraft}
              attachments={composer.attachments}
              onAddAttachments={composer.addAttachments}
              onRemoveAttachment={composer.removeAttachment}
              offline={session.offline}
              submitting={busy}
              disabled={!ready}
              onSubmit={(atts) => { void composer.submit(composer.draft, session.submitText, atts); }}
            />
          }
        />
      </div>
      {rightOpen ? (
        <aside className="qitu-tutor-context-sidebar" aria-label="项目进度与团队智能体">
          <div className="qitu-tutor-sidebar-header-row">
            <div className="qitu-tutor-sidebar-tabs" role="tablist" aria-label="项目侧栏视图">
              <button type="button" role="tab" aria-selected={rightSidebarTab === 'progress'} className={rightSidebarTab === 'progress' ? 'is-active' : ''} onClick={() => setRightSidebarTab('progress')}>项目进度</button>
              <button type="button" role="tab" aria-selected={rightSidebarTab === 'agents'} className={rightSidebarTab === 'agents' ? 'is-active' : ''} onClick={() => setRightSidebarTab('agents')}>团队智能体</button>
            </div>
            <button
              type="button"
              className="qitu-tutor-sidebar-close-btn"
              onClick={toggleContext}
              title="收起侧栏"
              aria-label="收起项目与进度侧栏"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect width="18" height="18" x="3" y="3" rx="4" />
                <path d="M15 3v18" />
                <path d="m8 9 3 3-3 3" />
              </svg>
            </button>
          </div>
          {rightSidebarTab === 'agents' ? (
            <TeamAgentHud
              key={projectId ?? session.explorationId}
              graph={teamGraph}
              status={teamGraphStatus}
              error={teamGraphError}
              offline={session.offline}
              permissionDenied={teamGraphError?.status === 403}
              onRetry={retryTeamGraph}
              loadHistory={source.getTeamHistory && projectId ? loadTeamHistory : undefined}
            />
          ) : session.projectStatus === 'loading' && (!projectSummary || (projectId && projectSummary.id !== projectId)) ? (
            <div className="qitu-tutor-state-panel" aria-busy="true"><SkeletonBlock lines={4} height={18} /></div>
          ) : session.projectStatus === 'error' ? (
            <ErrorState title="项目进度加载失败" description={session.projectError?.message} errorCode={session.projectError?.code} onRetry={session.retryProject} />
          ) : projectSummary && session.project ? (
            <>
              {session.offline ? <OfflineBanner readOnly onRetry={session.reconnect} /> : null}
              <ProjectCard project={projectSummary} />
              <CurrentLessonCard projectId={projectSummary.id} lesson={session.project.lesson ?? null}
                refreshKey={session.project} onProgressChanged={session.refreshProjectContext}
                disabled={!ready || busy || confirming || session.offline} />
              {session.project.lesson ? (
                <LessonLearningDock
                  open={lessonWorkOpen}
                  onOpenChange={setLessonWorkOpen}
                  projectId={projectSummary.id}
                  lesson={session.project.lesson}
                  refreshKey={session.project}
                  disabled={!ready || busy || confirming || session.offline}
                  onChanged={session.refreshProjectContext}
                  onExplain={message => { void composer.submit(message, session.submitText); }}
                />
              ) : null}
              {session.project.lesson ? <ProjectLearningHistory
                key={`${projectSummary.id}:${session.project.lesson.planId}:${session.project.lesson.planRevision}`}
                projectId={projectSummary.id} lesson={session.project.lesson} refreshKey={session.project}
                experiments={savedExperimentLinks(session.turns)} /> : null}
              <CurrentTask task={projectSummary.stage === 'completed' || projectSummary.stage === 'published' ? null : session.project.currentTask} />
            </>
          ) : (
            <ExplorationProgressPanel context={session.project} disabled={!ready || busy || confirming || session.offline}
              onConfirm={handleOneClickCreateProject} />
          )}
        </aside>
      ) : null}
    </ResizablePanels>
  </div>;
}

function toViewError(error: unknown): TutorViewError {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown; status?: unknown; code?: unknown };
    return {
      message: typeof candidate.message === 'string' ? candidate.message : '团队智能体加载失败',
      status: typeof candidate.status === 'number' ? candidate.status : undefined,
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
    };
  }
  return { message: '团队智能体加载失败' };
}
