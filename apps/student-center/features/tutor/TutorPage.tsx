'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PermissionDenied } from '@qitu/ui';
import { ProjectKnowledgeStatus } from './components/ProjectKnowledgeStatus';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { ProjectCard } from './components/ProjectCard';
import { CurrentTask } from './components/CurrentTask';
import { TutorSessionHistory } from './components/TutorSessionHistory';
import { TeamAgentHud } from './components/TeamAgentHud';
import { useComposer } from './hooks/useComposer';
import { useTutorSession } from './hooks/useTutorSession';
import { useTutorDataSource } from './TutorDataSourceProvider';
import { createIdempotencyKey } from './idempotency';

/** Teaching state and gate decisions come only from the owned server session. */
export function TutorPage({ projectId }: { projectId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = useTutorDataSource();
  const [explorationKey, setExplorationKey] = useState(0);
  const routeContextKey = searchParams.toString();
  const session = useTutorSession(projectId, routeContextKey || explorationKey);
  const composer = useComposer();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightSidebarTab, setRightSidebarTab] = useState<'progress' | 'agents'>('progress');
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const confirmKey = useRef<string | null>(null);

  const isThunder = /雷霆|战机|pygame|fighter/i.test(session.project?.project.title ?? '');
  const teamName = projectId ? (isThunder ? '雷霆战机团队' : '动能定理导师团队') : '启途智学助手';

  useEffect(() => {
    // 若进入学生端 AI 对话时未指定项目且未要求新探索，直接进入当前正在进行的执行中项目团队
    if (!projectId && !searchParams.get('new') && !searchParams.get('explorationId') && !searchParams.get('explorePrompt')) {
      let cancelled = false;
      void source.listProjects().then((projects) => {
        if (cancelled) return;
        const activeProject = projects.find((p) => p.stage !== 'completed') ?? projects[0];
        if (activeProject) {
          router.replace(`/tutor/${encodeURIComponent(activeProject.id)}`);
        }
      }).catch(() => {});
      return () => { cancelled = true; };
    }
  }, [projectId, searchParams, source, router]);

  useEffect(() => {
    // Discard legacy browser-stored credentials and fabricated transcripts.
    try {
      for (const key of ['qitu.tutor.sessions', 'qitu.llm.client_config', 'qitu.cached_configured_models']) localStorage.removeItem(key);
    } catch { /* Storage can be disabled; teaching does not depend on it. */ }
    const prompt = new URLSearchParams(window.location.search).get('explorePrompt');
    if (prompt) composer.setDraft(prompt);
  }, [composer.setDraft]);

  const ready = session.sessionStatus === 'ready' && session.connection === 'open';
  const busy = session.streaming || session.submitting || composer.submitting;
  const error = session.submitError ?? session.streamNotice ?? (confirmationError ? { message: confirmationError } : null);

  async function handleOneClickCreateProject(goal: string, interest: string) {
    if (!session.explorationId || !source.confirmExploration || confirming) return;
    setConfirming(true);
    setConfirmationError(null);
    confirmKey.current ??= createIdempotencyKey();
    try {
      const result = await source.confirmExploration(
        session.explorationId,
        { goal: goal.trim(), interest: interest.trim() },
        confirmKey.current,
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

  return <div className="qitu-tutor-page">
    <header className="qitu-tutor-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <div>
        <p className="qitu-tutor-eyebrow">启途智学 · 项目式学习</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0 }}>AI搭档</h1>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              padding: '2px 10px',
              borderRadius: '999px',
              background: projectId ? '#dbeafe' : '#f0fdf4',
              color: projectId ? '#1d4ed8' : '#15803d',
              border: `1px solid ${projectId ? '#bfdbfe' : '#bbf7d0'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>{projectId ? '👥' : '🧭'}</span>
            <span>{teamName}</span>
          </span>
        </div>
        <p className="qitu-tutor-header-subtitle">
          {projectId
            ? `已由专属导师团队【${teamName}】接管辅导；理论掌握由服务端核验。`
            : '由「启途智学助手」接管初步对话，确认意图后推荐项目，一键立项并唤醒导师团队。'}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span role="status">
          {session.offline
            ? '离线 · 暂停发送'
            : session.sessionStatus === 'error'
              ? session.sessionError?.status === 401
                ? '登录已失效'
                : '会话加载失败'
              : busy
                ? '导师正在处理'
                : ready
                  ? '教学会话已连接'
                  : '正在连接教学会话'}
        </span>
        <button type="button" className="qitu-button qitu-button-ghost" onClick={() => setRightOpen(!rightOpen)} aria-expanded={rightOpen}>项目与进度</button>
      </div>
    </header>
    <div className="qitu-tutor-workspace-layout">
      <TutorSessionHistory
        isOpen={leftOpen}
        onToggle={() => setLeftOpen(!leftOpen)}
        currentProjectId={projectId}
        currentExplorationId={session.explorationId}
        currentTitle={session.project?.project.title}
        currentTurnCount={session.turns.length}
        turns={session.turns}
        busy={busy || confirming}
        onNewExploration={newExploration}
        onSelectProject={(targetProjectId) => {
          if (busy || confirming) return;
          router.push(`/tutor/${encodeURIComponent(targetProjectId)}`, { scroll: false });
        }}
      />
      <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {error ? <div role="alert" style={{ padding: 12, color: '#9f1239', background: '#fff1f2' }}>{error.message} {error.code ? `（${error.code}）` : ''}<button type="button" onClick={session.dismissStreamNotice}>关闭提示</button></div> : null}
        {session.project?.project.id && <ProjectKnowledgeStatus projectId={session.project.project.id} />}
        <ChatThread
          sessionId={session.sessionId}
          turns={session.turns}
          currentAssistantName={teamName}
          status={session.sessionStatus === 'ready' && session.turns.length === 0 ? 'empty' : session.sessionStatus}
          error={session.sessionError}
          streaming={session.streaming}
          offline={session.offline}
          escalated={session.escalated}
          disabled={!ready || busy || confirming}
          onRetry={session.projectStatus === 'error' ? session.retryProject : session.retrySession}
          onReconnect={session.reconnect}
          onSelectOption={(label, text) => {
            if (!ready || busy || confirming) return;
            if (text) void composer.submit(text, session.submitText);
            else void session.selectOption(label).catch(() => undefined);
          }}
          onOneClickCreateProject={handleOneClickCreateProject}
          isConfirmingProject={confirming}
          isExploration={!projectId}
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
              onSubmit={(atts) => {
                void composer.submit(composer.draft, session.submitText, atts);
              }}
            />
          }
        />
      </div>
      {rightOpen ? (
        <aside className="qitu-tutor-context-sidebar" style={{ width: 'min(240px, 21vw)', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* 侧边栏两个 table / tab 视图切换：一个显示项目进度，一个显示各个 agent 的状态、头像、对话历史、工具调用情况 */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '10px', gap: '4px', border: '1px solid #e2e8f0' }}>
            <button
              type="button"
              onClick={() => setRightSidebarTab('progress')}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: rightSidebarTab === 'progress' ? 700 : 500,
                background: rightSidebarTab === 'progress' ? '#ffffff' : 'transparent',
                color: rightSidebarTab === 'progress' ? '#1d4ed8' : '#64748b',
                border: 'none',
                borderRadius: '7px',
                cursor: 'pointer',
                boxShadow: rightSidebarTab === 'progress' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              📊 项目进度
            </button>
            <button
              type="button"
              onClick={() => setRightSidebarTab('agents')}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: rightSidebarTab === 'agents' ? 700 : 500,
                background: rightSidebarTab === 'agents' ? '#ffffff' : 'transparent',
                color: rightSidebarTab === 'agents' ? '#1d4ed8' : '#64748b',
                border: 'none',
                borderRadius: '7px',
                cursor: 'pointer',
                boxShadow: rightSidebarTab === 'agents' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              👥 团队智能体
            </button>
          </div>

          {rightSidebarTab === 'agents' ? (
            <TeamAgentHud
              currentProjectId={projectId}
              currentTitle={session.project?.project.title}
              turns={session.turns}
            />
          ) : session.project ? (
            <>
              <ProjectCard project={session.project.project} />
              <CurrentTask task={session.project.currentTask} />
            </>
          ) : (
            <div style={{ padding: '14px 16px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 6px 0', color: '#1e293b' }}>正在形成的方向</h3>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: 1.6 }}>当前处于自由探索阶段，尚未创建正式项目。可在中间对话流中直接点击启途智学助手推荐的项目一键立项并唤醒导师团队。</p>
            </div>
          )}
        </aside>
      ) : null}
    </div>
  </div>;
}
