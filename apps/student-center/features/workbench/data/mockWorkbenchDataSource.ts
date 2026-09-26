import type { TemplateStage } from '@qitu/contracts';
import {
  WorkbenchConflictError,
  type PreviewResult,
  type PreviewableKind,
  type SimContent,
  type SimulatorRun,
  type SimulatorTranscriptEntry,
  type TutorSuggestion,
  type WorkbenchContent,
  type WorkbenchContentMap,
  type WorkbenchDraft,
  type WorkbenchKind,
  type WorkbenchProject,
  type WorkbenchSnapshot,
  type WorkbenchStageProgress,
} from '../types/workbench';
import type { WorkbenchDataSource } from './workbenchDataSource';

export interface MockWorkbenchOptions {
  /** Simulate the next PATCH answering 409 once (acceptance criterion 5). */
  conflictOnce?: boolean;
  /** Simulate the next GET failing once (error state). */
  failNextLoad?: boolean;
  /** Simulate a 403 on load (permission-denied state). */
  denyAccess?: boolean;
  /** Simulate the project having no stages yet (empty rail). */
  emptyStages?: boolean;
}

const SEED_STAGES: TemplateStage[] = [
  { id: 'concept', label: '创意构思' },
  { id: 'design', label: '流程设计' },
  { id: 'build', label: '动手制作' },
  { id: 'show', label: '展示分享' },
];

function seedContent(): WorkbenchContentMap {
  return {
    flow: {
      nodes: [
        {
          id: 'start',
          type: 'start',
          label: '开始',
          position: { x: 80, y: 160 },
          config: {},
        },
        {
          id: 'end',
          type: 'end',
          label: '结束',
          position: { x: 480, y: 160 },
          config: {},
        },
      ],
      edges: [],
    },
    code: { language: 'python', source: '' },
    sim: {
      scenario: {
        botName: '小助手',
        openingMessage: '你好，我们开始试聊吧！',
        resetPrompt: '重置对话',
      },
    },
    test: { cases: [] },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * In-memory mock data source. This is the ONLY place mock data lives; swapping
 * `data/index.ts` for the HTTP source repoints the whole page.
 */
export function createMockWorkbenchDataSource(
  options: MockWorkbenchOptions = {},
): WorkbenchDataSource {
  const drafts: WorkbenchContentMap = seedContent();
  const revisions: Record<WorkbenchKind, number> = { flow: 0, code: 0, sim: 0, test: 0 };
  const store = { conflictOnce: options.conflictOnce ?? false, failNextLoad: options.failNextLoad ?? false };
  let snapshotSeq = 0;
  let runSeq = 0;

  async function loadDraft<K extends WorkbenchKind>(
    _projectId: string,
    kind: K,
  ): Promise<WorkbenchDraft<K>> {
    if (store.failNextLoad) {
      store.failNextLoad = false;
      throw new Error('MOCK_LOAD_FAILED');
    }
    if (options.denyAccess) {
      throw new Error('FORBIDDEN');
    }
    return {
      projectId: _projectId,
      kind,
      revision: revisions[kind],
      content: drafts[kind] as WorkbenchContentMap[K],
      updatedAt: nowIso(),
    };
  }

  return {
    async getProject(projectId: string): Promise<WorkbenchProject> {
      if (options.denyAccess) throw new Error('FORBIDDEN');
      return {
        id: projectId,
        title: '桌面AI陪伴机器人',
        coverUrl: null,
        stage: 'practice_building',
        currentStageIndex: 2,
        stageTotal: options.emptyStages ? 0 : SEED_STAGES.length,
        progressPercent: 45,
      };
    },

    async getStageProgress(): Promise<WorkbenchStageProgress> {
      if (options.denyAccess) throw new Error('FORBIDDEN');
      return {
        stages: options.emptyStages ? [] : SEED_STAGES,
        currentStageIndex: 2,
        stageTotal: options.emptyStages ? 0 : SEED_STAGES.length,
        progressPercent: 45,
      };
    },

    async getDraft<K extends WorkbenchKind>(projectId: string, kind: K): Promise<WorkbenchDraft<K>> {
      return loadDraft(projectId, kind);
    },

    async patchDraft<K extends WorkbenchKind>(
      projectId: string,
      kind: K,
      revision: number,
      content: WorkbenchContent<K>,
    ): Promise<WorkbenchDraft<K>> {
      if (options.denyAccess) throw new Error('FORBIDDEN');
      if (store.conflictOnce) {
        store.conflictOnce = false;
        revisions[kind] = revision + 1;
        drafts[kind] = { ...drafts[kind], ...(content as WorkbenchContentMap[K]) };
        throw new WorkbenchConflictError({
          currentRevision: revisions[kind],
          content: drafts[kind],
        });
      }
      if (revision !== revisions[kind]) {
        throw new WorkbenchConflictError({
          currentRevision: revisions[kind],
          content: drafts[kind],
        });
      }
      revisions[kind] = revision + 1;
      drafts[kind] = content as WorkbenchContentMap[K];
      return {
        projectId,
        kind,
        revision: revisions[kind],
        content: content as WorkbenchContentMap[K],
        updatedAt: nowIso(),
      };
    },

    async createSnapshot<K extends WorkbenchKind>(
      projectId: string,
      kind: K,
      revision: number,
    ): Promise<WorkbenchSnapshot> {
      if (options.denyAccess) throw new Error('FORBIDDEN');
      if (revision !== revisions[kind]) {
        throw new WorkbenchConflictError({ currentRevision: revisions[kind], content: drafts[kind] });
      }
      snapshotSeq += 1;
      return {
        id: `snapshot-${snapshotSeq}`,
        projectId,
        kind,
        revision,
        content: drafts[kind] as WorkbenchContent,
        createdBy: 'student',
        createdAt: nowIso(),
      };
    },

    async preview(projectId: string, kind: PreviewableKind, revision: number): Promise<PreviewResult> {
      if (options.denyAccess) throw new Error('FORBIDDEN');
      if (revision !== revisions[kind]) {
        throw new WorkbenchConflictError({ currentRevision: revisions[kind], content: drafts[kind] });
      }
      return {
        runId: `preview-${projectId}-${kind}-${revision}`,
        kind,
        status: 'ready',
        previewUrl: `https://preview.qitu.local/${projectId}/${kind}/${revision}`,
        log: null,
      };
    },

    async runSimulator(projectId: string, input: string, draftRevision: number): Promise<SimulatorRun> {
      if (options.denyAccess) throw new Error('FORBIDDEN');
      runSeq += 1;
      const scenario: SimContent['scenario'] = drafts.sim.scenario;
      const transcript: SimulatorTranscriptEntry[] = [
        { role: 'student', text: input, at: nowIso() },
        {
          role: 'bot',
          text: scenario.botName
            ? `${scenario.botName}：收到「${input}」，我们继续试试下一步吧。`
            : `收到「${input}」，我们继续试试下一步吧。`,
          at: nowIso(),
        },
      ];
      return {
        id: `sim-run-${runSeq}`,
        projectId,
        draftRevision,
        input,
        transcript,
        createdAt: nowIso(),
      };
    },

    async getTutorSuggestions(): Promise<TutorSuggestion[]> {
      if (options.denyAccess) throw new Error('FORBIDDEN');
      return [
        {
          id: 'suggestion-1',
          move: 'hint',
          title: '先想清楚用户会怎么用',
          body: '你的流程里，用户输入之后机器人应该先回应还是先判断意图？',
        },
        {
          id: 'suggestion-2',
          move: 'scaffold',
          title: '把大问题拆小',
          body: '试着先只做「打招呼 → 判断意图」两步，跑通再扩展。',
        },
      ];
    },

    async heartbeat(): Promise<boolean> {
      return !options.denyAccess;
    },
  };
}

