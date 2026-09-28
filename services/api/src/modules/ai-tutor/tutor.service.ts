import { ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createEmptyTutorSdkPorts, createTutorSdk, type TutorSdk } from '@qitu/ai-client';

import type {
  GetTutorSessionResponse,
  ProjectStage,
  TutorHintLevel,
  TutorProjectContext,
  TutorSessionSummary,
  TutorToolCall,
  TutorTurn,
} from '@qitu/contracts';
import { DATA_MODE_TOKEN, type DataMode } from '../../database';
import { hashRequest, IdempotencyStore } from '../../common/idempotency';
import { AuditWriter } from '../../common/audit';
import {
  LEARNING_PROGRESS_STALL_SOURCE,
  LEARNING_STALL_ESCALATION_THRESHOLD,
  LearningStallSignalSink,
} from '../reminders/learning-stall-signal';
import { ModelGateway } from '../model-registry/model-gateway';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { createTutorProvider, type TutorModelGateway } from './gateway-tutor.provider';
import { TutorWorkspaceService } from './tutor-workspace.service';
import { InMemoryTutorSessionStore, TutorSessionStore } from './tutor-session.store';
import {
  type AppendTurnsInput,
  type TutorSessionSnapshot,
  type TutorTurnRecord,
} from './tutor-session.store';
import {
  type TutorProvider,
  type TutorStreamEvent,
  type TutorTurnInput,
} from './tutor.provider';

/** 一次流式回合的完整事件序列。缓存它是为了幂等重放：
 * 相同的 `idempotencyKey` 会得到逐字节一致的事件流，不会重复计费、
 * 不会重复写入掌握度，也不会重复产生审计记录。
 */
interface CachedTurn {
  turnId: string;
  events: StreamedTutorEvent[];
}

/**
 * 带序号的流式事件。`seq` 由**服务端**分配：学生回合占 1 个序号，
 * 随后每个事件各占 1 个，回合结束时 `lastSeq` 正好落在助手回合上。
 * 客户端只能从给定游标之后继续读，不能自行编号。
 */
export interface StreamedTutorEvent {
  seq: number;
  event: TutorStreamEvent;
}

/**
 * 会话的运行时记录：持久化快照 + 由回合序列**重放**出来的服务端判定状态。
 *
 * `lastHintLevel` / `stallCount` / `escalated` 在 `tutor_sessions` 表里没有列，
 * 它们完全由已持久化回合的 `pedagogicMove` / `hintLevel` 推导，因此进程重启
 * 或换实例后语义不变，客户端也永远无法写入。
 */
interface TutorSessionRecord extends TutorSessionSnapshot {
  lastHintLevel: TutorHintLevel | null;
  stallCount: number;
  escalated: boolean;
}

export interface AuditEntry {
  at: string;
  sessionId: string;
  projectId: string | null;
  actorId: string;
  action:
    | 'tutor.session_start'
    | 'tutor.turn'
    | 'tutor.escalate'
    | 'tutor.idempotent_replay'
    | 'tutor.guard_block';
  detail: string;
}

/** 演示项目上下文。真实实现应在 Wave-4 接 `projects` 模块。 */
const DEMO_PROJECT = {
  id: 'project-demo-001',
  title: '校园植物观察手册',
  stage: 'theory_learning' as ProjectStage,
  currentTaskTitle: '说明光合作用需要光',
};

const DEMO_SESSION_ID = 'session-demo-001';

/** 回合幂等的 operation 身份；再拼上 sessionId，避免同一 client key 跨会话复用。 */
const TUTOR_TURN_SCOPE = 'tutor.turn';

/** 租约必须长于一轮模型生成的最坏耗时，否则慢回合可能被并发回收。 */
const TUTOR_TURN_LEASE_MS = 120_000;

const PROJECT_STAGES = [
  { id: 'exploration', label: '探索' },
  { id: 'intent_confirmed', label: '确认意图' },
  { id: 'theory_learning', label: '理论学习' },
  { id: 'theory_check', label: '理论检验' },
  { id: 'practice_ready', label: '实践就绪' },
  { id: 'practice_building', label: '动手制作' },
  { id: 'artifact_review', label: '作品评审' },
  { id: 'reflection', label: '反思' },
  { id: 'published', label: '已发布' },
  { id: 'completed', label: '完成' },
] satisfies TutorProjectContext['stages'];

function currentTaskFor(
  projectId: string,
  title: string,
  stage: ProjectStage,
): TutorProjectContext['currentTask'] {
  if (stage === 'completed' || stage === 'published') return null;
  if (projectId === 'project-demo-001') {
    return {
      id: 'task-photosynthesis',
      title: '查一查：植物为什么需要阳光',
      detail: '找到 2 条证据，用自己的话说清楚光合作用。',
      isTodayFocus: true,
    };
  }
  return {
    id: `${projectId}-current-task`,
    title: `继续推进「${title}」`,
    detail: '打开项目查看当前阶段任务和下一步行动。',
    isTodayFocus: true,
  };
}

/**
 * AI搭档的会话与回合服务。
 *
 * 存储按 `QITU_DATA_MODE` 分流：
 * - `live` → `PostgresTutorSessionStore`，会话、回合、序号、幂等全部落库；
 * - `demo` / `test` → `InMemoryTutorSessionStore`，行为与旧内存实现一致。
 *
 * 无论哪种模式，**一切都是服务端权威**：提示等级、卡顿计数、升级状态、
 * `stage_after`、审计记录都不接受客户端写入。`seq` 由服务端分配，客户端
 * 只能从给定游标之后继续读取。
 *
 * 审计只记录动作元数据（谁、何时、哪个项目、哪个动作、面向学生的一句话
 * 结论），不落盘未成年人原始对话内容。
 */
@Injectable()
export class TutorService {
  private readonly provider: TutorProvider;
  private readonly tutorSdk: TutorSdk;
  private readonly sessions = new Map<string, TutorSessionRecord>();
  private readonly idempotency = new Map<string, CachedTurn>();
  private readonly auditLog: AuditEntry[] = [];
  private readonly store: TutorSessionStore;

  /**
   * Provider 按 `QITU_DATA_MODE` 选择：
   * - `live`（默认）→ `GatewayTutorProvider`，走注册表里绑定的真实模型；
   * - `demo` / `test` → 确定性的 `HeuristicTutorProvider`。
   *
   * live 下若 `tutor.chat` 未绑定，由 provider 显式返回
   * `MODEL_NOT_CONFIGURED`，不会静默回落到 Heuristic。
   *
   * `store` / `idempotencyStore` / `auditWriter` 是可选注入：直接 `new` 构造
   * （单元测试、stall 接线测试）时缺省为内存实现，与旧行为完全一致。
   */
  constructor(
    @Inject(DATA_MODE_TOKEN) dataMode: DataMode,
    @Inject(ModelGateway) gateway: TutorModelGateway,
    @Optional() private readonly platformData?: PlatformDataService,
    /**
     * 学习进度停滞信号接收端（ISSUE-T2）。
     *
     * 可选依赖：未接线时退化到不产生任何提醒（fail-closed）。提醒是否真的
     * 投递由提醒模块的评审门禁决定，AI 搭档不直接投递、不读取聊天原文。
     */
    @Optional()
    @Inject(LearningStallSignalSink)
    private readonly stallSink?: LearningStallSignalSink,
    @Optional()
    @Inject(TutorWorkspaceService)
    workspace?: TutorWorkspaceService,
    @Optional()
    @Inject(TutorSessionStore)
    store?: TutorSessionStore,
    @Optional()
    @Inject(IdempotencyStore)
    private readonly idempotencyStore?: IdempotencyStore,
    @Optional()
    @Inject(AuditWriter)
    private readonly auditWriter?: AuditWriter,
  ) {
    this.provider = createTutorProvider(dataMode, gateway);
    this.tutorSdk = createTutorSdk(workspace ?? createEmptyTutorSdkPorts());
    this.store = store ?? new InMemoryTutorSessionStore();
  }

  /** Return the student's authorized project projection for the AI搭档 shell. */
  getProjectContext(projectId: string | undefined, ownerId: string): TutorProjectContext | null {
    if (this.platformData === undefined) return null;
    const projects = this.platformData.getProjectsByStudent(ownerId);
    const selected = projectId === undefined
      ? projects.find((project) => project.stage !== 'completed' && project.stage !== 'published')
      : this.platformData.getProject(projectId);

    if (selected === null || selected === undefined) return null;
    if (selected.studentId !== ownerId) throw new ForbiddenException('无权访问该项目');

    const stages = PROJECT_STAGES;
    const currentStageIndex = Math.max(0, stages.findIndex((stage) => stage.id === selected.stage));
    return {
      project: {
        id: selected.projectId,
        title: selected.title,
        stage: selected.stage,
        progress: selected.progressPercent,
      },
      progress: {
        currentStageIndex,
        stageTotal: stages.length,
        progressPercent: selected.progressPercent,
      },
      stages,
      currentTask: currentTaskFor(selected.projectId, selected.title, selected.stage),
    };
  }

  /** 只会暴露给测试与内部审计；不通过 HTTP 暴露。 */
  get auditEntries(): readonly AuditEntry[] {
    return this.auditLog;
  }

  /** 是否为真实持久化存储；决定是否启用跨进程幂等与持久化审计。 */
  private get durable(): boolean {
    return this.store.durable;
  }

  /**
   * demo/test 的种子路径：只有**非持久化**的内存存储才回退到带历史种子的
   * 同步实现；持久化存储（含测试用的 durable 内存替身）一律走真实读写。
   */
  private get usesSeededMemory(): boolean {
    return !this.durable && this.store instanceof InMemoryTutorSessionStore;
  }

  /**
   * 取（或惰性创建）某个项目**属于该学生**的会话。
   *
   * 同步版本只在测试/demo 的内存路径上使用；HTTP 入口一律走
   * `resolveSession`（会先从持久化存储读回权威状态）。
   */
  getOrCreateSession(projectId: string, ownerId: string): TutorSessionRecord {
    const existing = this.findByProject(projectId);
    if (existing !== undefined) {
      assertOwnedBy(existing, ownerId);
      return existing;
    }
    // The demo project keeps its documented id so the frontend's fixture
    // fallback (`MOCK_SESSION_ID`) still lines up; every other project gets a
    // derived id instead of all colliding on the single demo id.
    const sessionId =
      projectId === DEMO_PROJECT.id ? DEMO_SESSION_ID : `session-${projectId}`;
    const record = this.seedSession(sessionId, projectId, ownerId);
    this.sessions.set(record.sessionId, record);
    // 会话开始即写审计，且只在真正创建时写一次：同 owner 重复取用不会重复记录。
    this.record({
      sessionId: record.sessionId,
      projectId: record.projectId,
      actorId: ownerId,
      action: 'tutor.session_start',
      detail: '学生开启 AI搭档会话',
    });
    return record;
  }

  /**
   * 持久化感知的取会话入口：HTTP 与流式回合都从这里拿权威状态。
   *
   * - 无存储（demo/test）→ 退回同步内存实现；
   * - 有存储 → 先按项目查持久化会话，命中则校验归属并水合到内存缓存；
   *   未命中则创建一条空会话（`last_seq = 0`）并写一次 `session_start` 审计。
   *
   * 归属不一致统一 403；创建/查回都以**服务端** owner 为准。
   */
  async resolveSession(projectId: string, ownerId: string): Promise<TutorSessionRecord> {
    if (this.usesSeededMemory) {
      return this.getOrCreateSession(projectId, ownerId);
    }
    const existing = await this.store.findByProject(projectId);
    if (existing !== null) {
      assertOwnedBy(existing, ownerId);
      return this.hydrate(existing);
    }
    // 外键 `tutor_sessions.partner_id` 需要搭档档案先存在。
    await this.tutorSdk.initialize();
    const sessionId =
      projectId === DEMO_PROJECT.id ? DEMO_SESSION_ID : `session-${projectId}`;
    const createdAt = new Date().toISOString();
    await this.store.create({
      sessionId,
      ownerId,
      partnerId: this.tutorSdk.partner.id,
      projectId,
      source: 'project',
      createdAt,
    });
    const record = this.hydrate({
      sessionId,
      ownerId,
      projectId,
      source: 'project',
      createdAt,
      lastSeq: 0,
      turns: [],
    });
    await this.commitAudit({
      sessionId: record.sessionId,
      projectId: record.projectId,
      actorId: ownerId,
      action: 'tutor.session_start',
      detail: '学生开启 AI搭档会话',
    });
    return record;
  }

  /**
   * 按 id 取会话，并校验归属。
   *
   * 授权先行的顺序：先按 id 查找，再校验 owner。归属不一致时统一 403，
   * 不返回任何会话字段；只有确实不存在时才 404。
   */
  getSession(sessionId: string, ownerId: string): TutorSessionRecord {
    const record = this.sessions.get(sessionId);
    if (record === undefined) throw new NotFoundException('会话不存在');
    assertOwnedBy(record, ownerId);
    return record;
  }

  /** 持久化感知的按 id 读取；HTTP `GET /sessions/:id` 使用。 */
  async loadSession(sessionId: string, ownerId: string): Promise<TutorSessionRecord> {
    if (this.usesSeededMemory) {
      return this.getSession(sessionId, ownerId);
    }
    const snapshot = await this.store.findById(sessionId);
    if (snapshot === null) throw new NotFoundException('会话不存在');
    assertOwnedBy(snapshot, ownerId);
    return this.hydrate(snapshot);
  }

  /** 契约 `GetTutorSessionResponse` 投影；不含审计与内部字段。 */
  toSessionResponse(record: TutorSessionRecord): GetTutorSessionResponse {
    return {
      sessionId: record.sessionId,
      projectId: record.projectId,
      // 只回投影字段：`pedagogicMove` / `expectedEvidence` / `promptVersion` /
      // `evidenceRef` 是服务端内部元数据，绝不进入学生响应。
      turns: record.turns.map(toContractTurn),
      lastSeq: record.lastSeq,
    };
  }

  getSummary(sessionId: string, ownerId: string): TutorSessionSummary {
    return this.toSummary(this.getSession(sessionId, ownerId));
  }

  /** 从已授权的运行时记录生成摘要；供异步入口复用。 */
  toSummary(record: TutorSessionRecord): TutorSessionSummary {
    return {
      summary: summarise(record),
      lastHintLevel: record.lastHintLevel,
      stallCount: record.stallCount,
      escalated: record.escalated,
    };
  }

  /**
   * 执行一个回合并流式产出事件。
   *
   * 幂等：
   * - live（durable + `IdempotencyStore`）→ 走 `IdempotencyService`（scope 含
   *   会话 id），服务重启/多实例重试同一 key 会命中已保存结果，不追加第二个回合；
   * - demo/test → 沿用内存 Map，语义一致但只在本进程内有效。
   *
   * 两种路径都在**整轮回合完成后**才产出事件：这样审计、掌握度、序号推进
   * 与事件流是一致原子单元，重连重放不会重复写入。
   */
  async *runTurn(
    record: TutorSessionRecord,
    request: {
      content?: string;
      pedagogicMove?: TutorTurnInput['pedagogicMove'];
      optionLabel?: string;
      idempotencyKey: string;
      actorId: string;
    },
  ): AsyncGenerator<StreamedTutorEvent, void, undefined> {
    // 纵深防御：即使调用方绕过了按 id 的授权查询，回合执行前仍校验归属。
    assertOwnedBy(record, request.actorId);

    if (this.durable && this.idempotencyStore !== undefined) {
      const scope = `${TUTOR_TURN_SCOPE}:${record.sessionId}`;
      const requestHash = hashRequest({
        sessionId: record.sessionId,
        actorId: request.actorId,
        content: request.content ?? null,
        pedagogicMove: request.pedagogicMove ?? null,
        optionLabel: request.optionLabel ?? null,
      });
      const result = await this.idempotencyStore.execute(
        scope,
        request.idempotencyKey,
        requestHash,
        async () => {
          const events = await this.executeTurn(record, request);
          return { status: 200, body: { events } };
        },
        { processingLeaseMs: TUTOR_TURN_LEASE_MS },
      );
      if (result.replayed) {
        await this.commitAudit({
          sessionId: record.sessionId,
          projectId: record.projectId,
          actorId: request.actorId,
          action: 'tutor.idempotent_replay',
          detail: `重放回合（key ${request.idempotencyKey}）`,
        });
      }
      for (const streamed of result.body.events) yield streamed;
      return;
    }

    const cached = this.idempotency.get(request.idempotencyKey);
    if (cached !== undefined && cached.turnId.startsWith(`${record.sessionId}:`)) {
      this.record({
        sessionId: record.sessionId,
        projectId: record.projectId,
        actorId: request.actorId,
        action: 'tutor.idempotent_replay',
        detail: `重放回合 ${cached.turnId}`,
      });
      for (const streamed of cached.events) yield streamed;
      return;
    }

    const events = await this.executeTurn(record, request);
    this.idempotency.set(request.idempotencyKey, {
      turnId: `${record.sessionId}:assistant:${record.lastSeq}`,
      events,
    });
    for (const streamed of events) yield streamed;
  }

  /**
   * 一个回合的完整执行：调用 provider、组装服务端权威回合、持久化、审计。
   *
   * 返回已缓冲的事件流（不是生成器），因此调用方可以先把回合写库/写审计，
   * 再决定如何回放——这正是重连不重复写入的关键。
   */
  private async executeTurn(
    record: TutorSessionRecord,
    request: {
      content?: string;
      pedagogicMove?: TutorTurnInput['pedagogicMove'];
      optionLabel?: string;
      idempotencyKey: string;
      actorId: string;
    },
  ): Promise<StreamedTutorEvent[]> {
    const baseSeq = record.lastSeq;
    const turnCount = record.turns.filter((turn) => turn.role === 'student').length;
    await this.tutorSdk.initialize();
    const liveProject = record.projectId === null || this.platformData === undefined
      ? null
      : this.platformData.getProject(record.projectId);
    const projectTitle = liveProject?.title ?? DEMO_PROJECT.title;
    const projectStage = liveProject?.stage ?? DEMO_PROJECT.stage;
    const currentTask = currentTaskFor(record.projectId ?? DEMO_PROJECT.id, projectTitle, projectStage);
    const currentTaskTitle = currentTask?.title ?? projectTitle;
    const contextPacket = await this.tutorSdk.buildContext({
      studentId: request.actorId,
      projectId: record.projectId,
      projectStage,
      currentGoal: currentTaskTitle,
      query: request.content ?? request.optionLabel ?? '当前学习任务',
      recentActivity: record.turns.slice(-6).map((turn) => `${turn.role}:${turn.blocks.length}个内容块`),
    });

    const input: TutorTurnInput = {
      projectId: record.projectId ?? DEMO_PROJECT.id,
      sessionId: record.sessionId,
      projectTitle,
      projectStage,
      currentTaskTitle,
      previousHintLevel: record.lastHintLevel,
      turnCount,
      contextPacket,
      ...(request.content !== undefined ? { content: request.content } : {}),
      ...(request.pedagogicMove !== undefined ? { pedagogicMove: request.pedagogicMove } : {}),
      ...(request.optionLabel !== undefined ? { optionLabel: request.optionLabel } : {}),
    };

    const promptVersion = this.tutorSdk.partner.promptVersion;
    const expectedEvidence = currentTask?.detail ?? null;

    const studentTurn: TutorTurnRecord = {
      turnId: `${record.sessionId}:student:${baseSeq + 1}`,
      role: 'student',
      blocks: buildStudentBlocks(request),
      hintLevel: null,
      stageBefore: projectStage,
      stageAfter: null,
      seq: baseSeq + 1,
      createdAt: new Date().toISOString(),
      modality: 'text',
      pedagogicMove: request.pedagogicMove ?? null,
      expectedEvidence,
      promptVersion,
      evidenceRef: `tutor_turn:${record.sessionId}:${baseSeq + 1}`,
    };

    const events: StreamedTutorEvent[] = [];
    let nextSeq = baseSeq + 1;
    let assistantBlocks: TutorTurn['blocks'] = [];
    let assistantHintLevel: TutorHintLevel | null = null;
    let guardBlocked = false;
    const pending = new Map<string, TutorToolCall>();

    for await (const event of this.provider.generateTurn(input)) {
      nextSeq += 1;
      const streamed: StreamedTutorEvent = { seq: nextSeq, event };
      events.push(streamed);
      switch (event.type) {
        case 'tool_call':
          pending.set(event.callId, {
            callId: event.callId,
            name: event.name,
            label: event.label,
            status: 'running',
          });
          break;
        case 'tool_result': {
          const call = pending.get(event.callId);
          if (call !== undefined) {
            call.status = event.status;
            call.result = event.result;
            assistantBlocks = [...assistantBlocks, { kind: 'tool', call: { ...call } }];
            // 只有安全闸门失败才算「拦截」；模型调用失败属于链路故障，
            // 不能误记成答案泄露拦截。
            if (event.status === 'error' && call.name === 'safety.answer_leak.guard') {
              guardBlocked = true;
            }
          }
          break;
        }
        case 'block':
          assistantBlocks = [...assistantBlocks, event.block];
          assistantHintLevel = blockHintLevel(event.block);
          break;
        case 'done':
          assistantHintLevel = event.turnSummary.hintLevel;
          break;
        default:
          break;
      }
    }

    // provider 契约保证至少有一个 `done` 事件；防御性兜底避免与助手回合撞号。
    const assistantSeq = nextSeq > baseSeq + 1 ? nextSeq : baseSeq + 2;
    const assistantTurn: TutorTurnRecord = {
      turnId: `${record.sessionId}:assistant:${assistantSeq}`,
      role: 'assistant',
      blocks: assistantBlocks,
      hintLevel: assistantHintLevel,
      stageBefore: projectStage,
      // 服务端决定阶段推进；这里保持当前阶段，避免助手回合擅自改阶段。
      stageAfter: projectStage,
      seq: assistantSeq,
      createdAt: new Date().toISOString(),
      modality: 'text',
      // 教学动作属于学生输入；助手回合不重复记一次，避免重放时双重计数。
      pedagogicMove: null,
      expectedEvidence,
      promptVersion,
      evidenceRef: `tutor_turn:${record.sessionId}:${assistantSeq}`,
    };

    // 先落库再改内存：写失败（并发冲突）时运行时记录保持干净，可由上层重试。
    if (this.durable) {
      const append: AppendTurnsInput = {
        sessionId: record.sessionId,
        expectedLastSeq: baseSeq,
        newLastSeq: assistantSeq,
        turns: [studentTurn, assistantTurn],
      };
      await this.store.appendTurns(append);
    }

    record.lastSeq = assistantSeq;
    record.turns.push(studentTurn, assistantTurn);
    if (assistantHintLevel !== null) record.lastHintLevel = assistantHintLevel;
    const escalatedNow = this.trackStall(record, request.pedagogicMove);

    await this.commitAudit({
      sessionId: record.sessionId,
      projectId: record.projectId,
      actorId: request.actorId,
      action: guardBlocked ? 'tutor.guard_block' : 'tutor.turn',
      detail: `回合 ${assistantSeq}，提示等级 ${assistantHintLevel ?? '未变更'}`,
    });
    await this.tutorSdk.recordGrowthSignal({
      idempotencyKey: `tutor-turn:${record.sessionId}:${assistantSeq}`,
      studentId: request.actorId,
      projectId: record.projectId,
      kind: 'question_asked',
      summary: '学生完成了一次学习搭档对话回合',
      evidenceRef: `tutor_turn:${record.sessionId}:${assistantSeq}`,
      occurredAt: new Date().toISOString(),
    });
    if (escalatedNow) {
      await this.commitAudit({
        sessionId: record.sessionId,
        projectId: record.projectId,
        actorId: 'system',
        action: 'tutor.escalate',
        detail: `连续 ${record.stallCount} 轮卡顿，建议班主任介入`,
      });
    }
    return events;
  }

  /** 把持久化快照水合为运行时记录，并从回合序列重放服务端判定状态。 */
  private hydrate(snapshot: TutorSessionSnapshot): TutorSessionRecord {
    const derived = deriveSessionState(snapshot.turns);
    const record: TutorSessionRecord = {
      ...snapshot,
      turns: snapshot.turns.slice(),
      lastHintLevel: derived.lastHintLevel,
      stallCount: derived.stallCount,
      escalated: derived.escalated,
    };
    this.sessions.set(record.sessionId, record);
    return record;
  }

  /**
   * 演示会话的初始历史。
   *
   * 它刻意停在第 1 档提示上，且 **没有任何 assistant 文本块是完整答案**：
   * 历史必须与实时流遵守同一条「只提问不给答案」规则，否则学生会从历史里
   * 读到实时流不肯给的结论。
   */
  private seedSession(
    sessionId: string,
    projectId: string,
    ownerId: string,
  ): TutorSessionRecord {
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    const base: Omit<TutorTurnRecord, 'seq' | 'role' | 'blocks' | 'hintLevel' | 'stageBefore' | 'stageAfter' | 'turnId' | 'createdAt' | 'modality'> = {
      pedagogicMove: null,
      expectedEvidence: '找到 2 条证据，用自己的话说清楚光合作用。',
      promptVersion: this.tutorSdk.partner.promptVersion,
      evidenceRef: null,
    };
    const turns: TutorTurnRecord[] = [
      {
        ...base,
        turnId: `${sessionId}:student:1`,
        role: 'student',
        blocks: [{ kind: 'text', text: '老师让我们做校园植物观察手册，我不知道从哪开始。' }],
        hintLevel: null,
        stageBefore: DEMO_PROJECT.stage,
        stageAfter: null,
        seq: 1,
        createdAt: at(-600_000),
        modality: 'text',
      },
      {
        ...base,
        turnId: `${sessionId}:assistant:2`,
        role: 'assistant',
        blocks: [
          { kind: 'hint', level: 1, text: '你观察过的植物里，哪一株让你最好奇？先说说它哪里特别。' },
        ],
        hintLevel: 1,
        stageBefore: DEMO_PROJECT.stage,
        stageAfter: DEMO_PROJECT.stage,
        seq: 2,
        createdAt: at(-580_000),
        modality: 'text',
        pedagogicMove: 'hint',
      },
      {
        ...base,
        turnId: `${sessionId}:student:3`,
        role: 'student',
        blocks: [{ kind: 'text', text: '走廊那盆绿萝，放窗边就长得快，放教室后面就变黄。' }],
        hintLevel: null,
        stageBefore: DEMO_PROJECT.stage,
        stageAfter: null,
        seq: 3,
        createdAt: at(-420_000),
        modality: 'text',
      },
      {
        ...base,
        turnId: `${sessionId}:assistant:4`,
        role: 'assistant',
        blocks: [
          { kind: 'text', text: '这个对比很有意思——同一盆植物，只换了一个条件。' },
          { kind: 'hint', level: 2, text: '如果只能用一句话描述你猜到的原因，你会怎么说？' },
        ],
        hintLevel: 2,
        stageBefore: DEMO_PROJECT.stage,
        stageAfter: DEMO_PROJECT.stage,
        seq: 4,
        createdAt: at(-400_000),
        modality: 'text',
        pedagogicMove: 'hint',
      },
      {
        ...base,
        turnId: `${sessionId}:student:5`,
        role: 'student',
        blocks: [{ kind: 'text', text: '我觉得是光，光多它就长得好。' }],
        hintLevel: null,
        stageBefore: DEMO_PROJECT.stage,
        stageAfter: null,
        seq: 5,
        createdAt: at(-200_000),
        modality: 'text',
      },
      {
        ...base,
        turnId: `${sessionId}:assistant:6`,
        role: 'assistant',
        blocks: [
          { kind: 'hint', level: 2, text: '「光多就长得好」是个可以检验的说法。你打算怎么让别人也看到光在起作用？' },
        ],
        hintLevel: 2,
        stageBefore: DEMO_PROJECT.stage,
        stageAfter: DEMO_PROJECT.stage,
        seq: 6,
        createdAt: at(-180_000),
        modality: 'text',
        pedagogicMove: 'hint',
      },
    ];
    return {
      sessionId,
      ownerId,
      projectId,
      source: 'project',
      createdAt: at(-600_000),
      turns,
      lastSeq: 6,
      lastHintLevel: 2,
      stallCount: 0,
      escalated: false,
    };
  }

  private findByProject(projectId: string): TutorSessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.projectId === projectId) return record;
    }
    return undefined;
  }

  /**
   * 连续 4 轮出现卡顿信号 → 升级给班主任（服务端判定，客户端不可写）。
   *
   * 返回**本次**是否首次越过阈值；`escalated` 一旦置位便粘住，重启后由
   * `deriveSessionState` 从回合序列重放得到相同结果。
   */
  private trackStall(
    record: TutorSessionRecord,
    move: TutorTurnInput['pedagogicMove'],
  ): boolean {
    if (move === 'stall_signal') {
      record.stallCount += 1;
    } else if (move !== undefined) {
      record.stallCount = 0;
    }
    const threshold = record.stallCount >= LEARNING_STALL_ESCALATION_THRESHOLD;
    const crossedEscalation = !record.escalated && threshold;
    record.escalated = record.escalated || threshold;
    if (crossedEscalation) {
      // 只在**首次**越过阈值时上报一次，避免每多卡一轮就重复生成提醒。
      // 提醒模块按 `source:studentId:stallCount` 去重，重复上报也是幂等的。
      this.stallSink?.ingestStallSignal({
        studentId: record.ownerId,
        stallCount: record.stallCount,
        source: LEARNING_PROGRESS_STALL_SOURCE,
      });
    }
    return crossedEscalation;
  }

  private record(entry: Omit<AuditEntry, 'at'>): void {
    this.auditLog.push({ at: new Date().toISOString(), ...entry });
    if (this.auditLog.length > 500) this.auditLog.splice(0, this.auditLog.length - 500);
  }

  /**
   * 写一条审计：内存日志永远写（测试可见），durable 模式下再落
   * `audit_logs`。两处都只记动作元数据，不记原始对话。
   */
  private async commitAudit(entry: Omit<AuditEntry, 'at'>): Promise<void> {
    this.record(entry);
    if (!this.durable || this.auditWriter === undefined) return;
    await this.auditWriter.write({
      actorId: entry.actorId === 'system' ? null : entry.actorId,
      actorRole: entry.actorId === 'system' ? null : 'student',
      action: entry.action,
      targetType: 'tutor_session',
      targetId: entry.sessionId,
      detail: { projectId: entry.projectId, summary: entry.detail },
    });
  }
}

/**
 * 统一越权文案：不区分「非法角色」「不存在」「不属于你」，
 * 避免调用方通过响应差异探测会话是否存在或属于谁。
 */
const FORBIDDEN_MESSAGE = '无权访问该会话';

/** 断言会话归属；不一致统一 403，且不泄露任何会话字段。 */
function assertOwnedBy(record: { ownerId: string }, ownerId: string): void {
  if (record.ownerId !== ownerId) throw new ForbiddenException(FORBIDDEN_MESSAGE);
}

/** 从回合序列重放会话级服务端状态（无专用列，重启后结果一致）。 */
function deriveSessionState(turns: readonly TutorTurnRecord[]): {
  lastHintLevel: TutorHintLevel | null;
  stallCount: number;
  escalated: boolean;
} {
  let lastHintLevel: TutorHintLevel | null = null;
  let stallCount = 0;
  let escalated = false;
  for (const turn of turns) {
    if (turn.hintLevel !== null) lastHintLevel = turn.hintLevel;
    // 卡顿信号只记在学生回合上，且每个回合只重放一次，与实时 `trackStall` 对齐。
    if (turn.role !== 'student') continue;
    if (turn.pedagogicMove === 'stall_signal') {
      stallCount += 1;
    } else if (turn.pedagogicMove !== null) {
      stallCount = 0;
    }
    if (stallCount >= LEARNING_STALL_ESCALATION_THRESHOLD) escalated = true;
  }
  return { lastHintLevel, stallCount, escalated };
}

/** 剥离服务端专用元数据，只回契约字段。 */
function toContractTurn(turn: TutorTurnRecord): TutorTurn {
  const {
    pedagogicMove: _pedagogicMove,
    expectedEvidence: _expectedEvidence,
    promptVersion: _promptVersion,
    evidenceRef: _evidenceRef,
    ...contract
  } = turn;
  return contract;
}

function buildStudentBlocks(request: {
  content?: string;
  optionLabel?: string;
}): TutorTurn['blocks'] {
  const text = request.content ?? request.optionLabel ?? '';
  return text.length > 0 ? [{ kind: 'text', text }] : [];
}

function blockHintLevel(block: TutorTurn['blocks'][number]): TutorHintLevel | null {
  return block.kind === 'hint' ? block.level : null;
}

function summarise(record: TutorSessionRecord): string {
  const studentTurns = record.turns.filter((turn) => turn.role === 'student').length;
  const level = record.lastHintLevel === null ? '尚未给出提示' : `当前提示等级第 ${record.lastHintLevel} 档`;
  return `本次会话共 ${studentTurns} 轮提问，${level}。`;
}
