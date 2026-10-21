'use client';

import { VisualAsset } from '@qitu/ui';

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
import { CurrentLessonCard, LessonLearningWorkspace } from './components/CurrentLessonCard';
import { TutorTeamRail } from './components/TutorTeamRail';
import { useComposer } from './hooks/useComposer';
import { useTutorViewport } from './hooks/useTutorViewport';
import { useTutorSession } from './hooks/useTutorSession';
import { useTutorTeamGraph } from './hooks/useTutorTeamGraph';
import { ExplorationProgressPanel } from './components/ExplorationProgressPanel';
import { useTutorDataSource } from './TutorDataSourceProvider';
import { createIdempotencyKey } from './idempotency';
import { getStoredEyecare, setStoredEyecare, subscribeEyecare } from './lib/eyecareStorage';
import { LessonAssessmentCard } from './components/LessonAssessmentCard';
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
  const session = useTutorSession(projectId, routeContextKey || explorationKey);
  const composer = useComposer();
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
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
  const ready = session.sessionStatus === 'ready' && session.connection === 'open';
  const busy = session.streaming || session.submitting || composer.submitting;

  useEffect(() => {
    // Entering AI搭档 without an explicit exploration opens the current project.
    if (!projectId && searchParams.get('idle') !== '1' && !searchParams.get('new') && !searchParams.get('explorationId') && !searchParams.get('explorePrompt')) {
      let cancelled = false;
      void source.listProjects().then((projects) => {
        if (cancelled) return;
        const activeProject = projects.find((p) => p.isCurrent);
        if (activeProject) router.replace(`/tutor/${encodeURIComponent(activeProject.id)}`);
      }).catch(() => {
        // The session surface will expose the server error; never insert demo data.
      });
      return () => { cancelled = true; };
    }
  }, [projectId, searchParams, source, router]);

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
    if (projectId) { router.push('/tutor?new=1', { scroll: false }); return; }
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
              : busy ? '导师正在处理' : ready ? '教学会话已连接' : searchParams.get('idle') === '1' ? '选择会话或开始新的探索' : '正在连接教学会话'}
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
        {projectSummary ? (
          <button
            type="button"
            className="qitu-button qitu-button-ghost"
            disabled={!ready || busy || confirming || session.offline}
            onClick={() => {
              void composer.submit(
                '请在当前 AI 搭档会话中打开动态物理课件，先让我提交预测，再运行单缝衍射或散射仿真。',
                session.submitText,
              );
            }}
          >
            <span><VisualAsset assetId="activity-experiment-v1" size={24} /></span> 动态实验课件
          </button>
        ) : null}

        <button type="button" className="qitu-button qitu-button-ghost" onClick={toggleContext} aria-expanded={rightOpen}>
          项目与进度
        </button>
      </div>
    </header>
    <div className="qitu-tutor-workspace-layout">
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
      <div className="qitu-tutor-center-column">
        {session.projectRefreshError ? <div role="alert" className="qitu-tutor-inline-alert">
          {session.projectRefreshError.message}<button type="button" onClick={() => { void session.refreshProjectContext(); }}>重新读取课时</button>
        </div> : null}
        {error ? <div role="alert" className="qitu-tutor-inline-alert">{error.message} {error.code ? `（${error.code}）` : ''}<button type="button" onClick={session.dismissStreamNotice}>关闭提示</button></div> : null}
        <ChatThread
          sessionId={session.sessionId}
          turns={session.turns}
          currentAssistantName={currentAssistantName}
          explorationContext={session.project?.exploration ? session.project : undefined}
          idle={searchParams.get('idle') === '1'}
          status={session.sessionStatus === 'ready' && session.turns.length === 0 ? 'empty' : session.sessionStatus}
          error={session.sessionError}
          streaming={session.streaming}
          offline={session.offline}
          escalated={session.escalated}
          disabled={!ready || busy || confirming}
          onRetry={session.projectStatus === 'error' ? session.retryProject : session.retrySession}
          onNewExploration={newExploration}
          onReconnect={session.reconnect}
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
          learningActivity={projectSummary && session.project?.lesson ? <><LessonAssessmentCard
            key={`${projectSummary.id}:${session.project.lesson.planId}:${session.project.lesson.planRevision}:${session.project.lesson.learningSessionId}`}
            projectId={projectSummary.id} lesson={session.project.lesson} disabled={!ready || busy || confirming || session.offline}
            onChanged={session.refreshProjectContext}
          /><LessonLearningWorkspace projectId={projectSummary.id} lesson={session.project.lesson}
            refreshKey={session.project} disabled={!ready || busy || confirming || session.offline}
            onProgressChanged={session.refreshProjectContext} /></> : null}
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
          <div className="qitu-tutor-sidebar-tabs" role="tablist" aria-label="项目侧栏视图">
            <button type="button" role="tab" aria-selected={rightSidebarTab === 'progress'} className={rightSidebarTab === 'progress' ? 'is-active' : ''} onClick={() => setRightSidebarTab('progress')}>项目进度</button>
            <button type="button" role="tab" aria-selected={rightSidebarTab === 'agents'} className={rightSidebarTab === 'agents' ? 'is-active' : ''} onClick={() => setRightSidebarTab('agents')}>团队智能体</button>
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
          ) : session.projectStatus === 'loading' ? (
            <div className="qitu-tutor-state-panel" aria-busy="true"><SkeletonBlock lines={4} height={18} /></div>
          ) : session.projectStatus === 'error' ? (
            <ErrorState title="项目进度加载失败" description={session.projectError?.message} errorCode={session.projectError?.code} onRetry={session.retryProject} />
          ) : session.offline ? (
            <OfflineBanner readOnly onRetry={session.reconnect} />
          ) : projectSummary && session.project ? (
            <>
              <ProjectCard project={projectSummary} />
              <TutorTeamRail phases={session.project.phases ?? []} />
              <CurrentTask task={session.project.currentTask} />
              <CurrentLessonCard projectId={projectSummary.id} lesson={session.project.lesson ?? null}
                refreshKey={session.project} onProgressChanged={session.refreshProjectContext}
                disabled={!ready || busy || confirming || session.offline} />
            </>
          ) : (
            <ExplorationProgressPanel context={session.project} disabled={!ready || busy || confirming || session.offline}
              onConfirm={handleOneClickCreateProject} />
          )}
        </aside>
      ) : null}
    </div>
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
