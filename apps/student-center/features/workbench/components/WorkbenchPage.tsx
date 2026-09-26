'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PedagogicMove, ProjectStage, TemplateStage } from '@qitu/contracts';
import { EmptyState, ErrorState, OfflineBanner, PermissionDenied, SectionCard, SkeletonBlock } from '@qitu/ui';
import { workbenchDataSource, type WorkbenchDataSource } from '../data';
import { useConnectivity } from '../hooks/useConnectivity';
import { useSimulatorRun } from '../hooks/useSimulatorRun';
import { useWorkbenchDraft } from '../hooks/useWorkbenchDraft';
import {
  isCodeContent,
  isFlowContent,
  isSimContent,
  isTestContent,
  type TutorSuggestion,
  type WorkbenchContent,
  type WorkbenchDraft,
  type WorkbenchProject,
} from '../types/workbench';
import { AutosaveStatus } from './AutosaveStatus';
import { CodeEditor } from './CodeEditor';
import { ConflictDialog } from './ConflictDialog';
import { FlowCanvas } from './FlowCanvas';
import { NodePalette } from './NodePalette';
import { SimulatorPanel } from './SimulatorPanel';
import { StageRail } from './StageRail';
import { TestEditor } from './TestEditor';
import { TutorAdviceRail } from './TutorAdviceRail';
import { WorkbenchActionBar } from './WorkbenchActionBar';
import { WorkbenchBreadcrumb } from './WorkbenchBreadcrumb';
import { WorkbenchHeader } from './WorkbenchHeader';
import { WorkbenchTabs } from './WorkbenchTabs';
import { ZoomUndoBar } from './ZoomUndoBar';

/**
 * Stages BEFORE these are theory-side; practice affordances must not render.
 * The gate reads the server-owned `ProjectStage` — never `currentStageIndex`.
 */
const THEORY_SIDE_STAGES: readonly ProjectStage[] = [
  'exploration',
  'intent_confirmed',
  'theory_learning',
  'theory_check',
];

const FLOW_NODE_TYPES = ['start', 'ai_reply', 'intent_branch', 'action', 'end'] as const;

export interface WorkbenchPageProps {
  projectId: string;
  initialProject: WorkbenchProject;
  initialStages: TemplateStage[];
  initialDraft: WorkbenchDraft;
  dataSource?: WorkbenchDataSource;
  finishHref?: string;
}

export function WorkbenchPage({
  projectId,
  initialProject,
  initialStages,
  initialDraft,
  dataSource = workbenchDataSource,
  finishHref,
}: WorkbenchPageProps) {
  const heartbeat = useCallback(() => dataSource.heartbeat(), [dataSource]);
  const connectivity = useConnectivity(heartbeat);
  const controller = useWorkbenchDraft({
    projectId,
    dataSource,
    initialDraft,
    online: connectivity.online,
  });

  const [zoom, setZoom] = useState(1);
  const [previewing, setPreviewing] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tutorNotice, setTutorNotice] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<TutorSuggestion[]>([]);
  useEffect(() => {
    let cancelled = false;
    dataSource
      .getTutorSuggestions(projectId)
      .then((next) => {
        if (!cancelled) setSuggestions(next);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource]);

  // A failed PATCH (transport offline) must also drive the read-only + banner
  // state, not just `navigator.onLine` — otherwise a request failure shows no
  // offline surface (workbench-spec §5「断网即只读」).
  const transportOffline = controller.status === 'offline-buffering';

  const simulator = useSimulatorRun({
    projectId,
    dataSource,
    draftRevision: controller.revision,
    enabled:
      connectivity.online &&
      !transportOffline &&
      controller.conflict === null &&
      controller.activeKind === 'sim',
  });

  const gateOpen = !THEORY_SIDE_STAGES.includes(initialProject.stage);
  const readOnly = !connectivity.online || transportOffline || controller.conflict !== null;
  const bufferedCount = controller.dirty ? 1 : 0;

  const updateContent = useCallback(
    (next: WorkbenchContent) => controller.updateContent(next),
    [controller],
  );

  const onPreview = useCallback(async () => {
    if (controller.activeKind === 'sim') return;
    setPreviewing(true);
    setActionError(null);
    try {
      const revision = await controller.flush();
      const result = await dataSource.preview(projectId, controller.activeKind, revision);
      setPreviewUrl(result.previewUrl);
      if (result.status === 'failed') setActionError(result.log ?? '预览失败');
    } catch {
      setActionError('预览失败，请稍后重试。');
    } finally {
      setPreviewing(false);
    }
  }, [controller, dataSource, projectId]);

  const onSnapshot = useCallback(async () => {
    setSnapshotting(true);
    setActionError(null);
    try {
      const revision = await controller.flush();
      const snapshot = await dataSource.createSnapshot(projectId, controller.activeKind, revision);
      setSnapshotId(snapshot.id);
    } catch {
      setActionError('保存成果失败，请稍后重试。');
    } finally {
      setSnapshotting(false);
    }
  }, [controller, dataSource, projectId]);

  const onFinish = useCallback(() => {
    setFinishing(true);
    const href = finishHref ?? `/student/projects/${projectId}/works`;
    if (typeof window !== 'undefined') window.location.assign(href);
    else setFinishing(false);
  }, [finishHref, projectId]);

  const onAskTutor = useCallback((move: PedagogicMove) => {
    // Gap: tutor session/turn endpoints are not yet in the data source.
    setTutorNotice(`已请求「${move}」，AI搭档正在准备建议…`);
  }, []);
  const onSendTutor = useCallback(() => {
    setTutorNotice('已发送，AI搭档正在准备建议…');
  }, []);

  const body = () => {
    if (controller.permissionDenied) {
      return (
        <PermissionDenied
          title="无法访问这个工作台"
          description="你没有查看或编辑该项目草稿的权限。"
          onBack={() => {
            if (typeof window !== 'undefined') window.location.assign('/student/projects');
          }}
        />
      );
    }
    if (controller.error) {
      return (
        <ErrorState
          title="工作台加载失败"
          description="网络或服务异常，请重试。"
          errorCode={controller.error}
          onRetry={controller.reload}
        />
      );
    }
    if (controller.loading) {
      return (
        <div className="qitu-workbench-loading">
          <SkeletonBlock lines={2} height={28} width="40%" />
          <SkeletonBlock lines={6} height={18} />
        </div>
      );
    }

    const content = controller.content;
    if (!content) {
      return (
        <EmptyState title="这个工作区还是空的" description="开始编辑后内容会自动保存。" />
      );
    }

    if (controller.activeKind === 'flow') {
      if (!isFlowContent(content)) return null;
      return (
        <div className="qitu-flow-workspace">
          <NodePalette nodeTypes={[...FLOW_NODE_TYPES]} disabled={readOnly} onAddNode={() => undefined} />
          <div className="qitu-flow-canvas-wrap">
            <FlowCanvas
              nodes={content.nodes}
              edges={content.edges}
              selectedNodeId={null}
              readOnly={readOnly}
              onSelectNode={() => undefined}
              onNodesChange={(nodes) => updateContent({ ...content, nodes })}
              onEdgesChange={(edges) => updateContent({ ...content, edges })}
            />
            <ZoomUndoBar
              zoom={zoom}
              canUndo={false}
              canRedo={false}
              disabled={readOnly}
              onZoomIn={() => setZoom((value) => Math.min(2, value + 0.1))}
              onZoomOut={() => setZoom((value) => Math.max(0.4, value - 0.1))}
              onUndo={() => undefined}
              onRedo={() => undefined}
            />
          </div>
        </div>
      );
    }

    if (controller.activeKind === 'code') {
      if (!isCodeContent(content)) return null;
      return <CodeEditor value={content} readOnly={readOnly} onChange={updateContent} />;
    }

    if (controller.activeKind === 'sim') {
      if (!isSimContent(content)) return null;
      return (
        <SimulatorPanel
          scenario={content.scenario}
          transcript={simulator.transcript}
          sending={simulator.sending}
          error={simulator.error}
          disabled={readOnly}
          onSend={(input) => void simulator.send(input)}
          onReset={simulator.reset}
        />
      );
    }

    if (!isTestContent(content)) return null;
    return <TestEditor value={content} readOnly={readOnly} onChange={updateContent} />;
  };

  if (!gateOpen) {
    return (
      <div className="qitu-workbench">
        <WorkbenchBreadcrumb projectTitle={initialProject.title} />
        <WorkbenchHeader project={initialProject} stages={initialStages} activeIndex={initialProject.currentStageIndex} />
        <SectionCard title="还不能开始制作">
          <EmptyState
            title="先完成理论学习"
            description="《TheoryMastered》达成后，制作工作台才会开放。请先去完成学习计划与检查。"
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="qitu-workbench" data-online={!transportOffline && connectivity.online ? 'true' : 'false'}>
      {!connectivity.online || transportOffline ? (
        <OfflineBanner readOnly bufferedCount={bufferedCount} onRetry={connectivity.retry} />
      ) : null}

      <WorkbenchBreadcrumb projectTitle={initialProject.title} />
      <WorkbenchHeader project={initialProject} stages={initialStages} activeIndex={initialProject.currentStageIndex} />

      <div className="qitu-workbench-grid">
        <StageRail stages={initialStages} activeIndex={initialProject.currentStageIndex} />

        <div className="qitu-workbench-main">
          <div className="qitu-workbench-toolbar">
            <WorkbenchTabs activeKind={controller.activeKind} onChange={controller.setActiveKind} disabled={readOnly} />
            <AutosaveStatus
              status={controller.status}
              savedAt={controller.savedAt}
              bufferedAt={controller.bufferedAt}
            />
          </div>

          <SectionCard title="工作区">
            {body()}
          </SectionCard>

          {actionError ? <p className="qitu-workbench-action-error">{actionError}</p> : null}
          {snapshotId ? <p className="qitu-workbench-action-note">已保存成果（{snapshotId}）</p> : null}

          <WorkbenchActionBar
            previewing={previewing}
            saving={snapshotting}
            finishing={finishing}
            disabled={readOnly}
            previewDisabled={readOnly || controller.activeKind === 'sim'}
            previewUrl={previewUrl}
            onPreview={() => void onPreview()}
            onSnapshot={() => void onSnapshot()}
            onFinish={onFinish}
          />
        </div>

        <TutorAdviceRail
          projectId={projectId}
          sessionId={null}
          suggestions={suggestions}
          disabled={readOnly}
          onAsk={onAskTutor}
          onSend={onSendTutor}
        />
      </div>

      {tutorNotice ? <p className="qitu-workbench-action-note">{tutorNotice}</p> : null}

      {controller.conflict ? (
        <ConflictDialog
          conflict={controller.conflict}
          resolving={controller.status === 'saving'}
          onResolve={(choice) => void controller.resolveConflict(choice)}
        />
      ) : null}
    </div>
  );
}
