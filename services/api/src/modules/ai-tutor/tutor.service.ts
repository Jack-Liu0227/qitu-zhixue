import { ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
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
import { ModelGateway } from '../model-registry/model-gateway';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { createTutorProvider, type TutorModelGateway } from './gateway-tutor.provider';
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

interface TutorSessionRecord {
  sessionId: string;
  /**
   * 会话归属的学生 user id。这是**会话级**的临时授权边界：
   * 只要归属不一致就统一 403，且不返回任何会话字段。
   *
   * 未来 `projects` 模块落地后，还必须在此之上校验
   * `project.studentUserId === ownerId`（以及班主任的当前分配关系），
   * 不能把硬编码的 DEMO_PROJECT 当成授权真相。
   */
  ownerId: string;
  projectId: string | null;
  createdAt: string;
  turns: TutorTurn[];
  lastSeq: number;
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
 * 存储是内存实现（M1 范围内），但**一切都是服务端权威**：提示等级、卡顿
 * 计数、升级状态、审计记录都不接受客户端写入。`seq` 由服务端分配，
 * 客户端只能从给定游标之后继续读取。
 *
 * 审计只记录动作元数据（谁、何时、哪个项目、哪个动作、面向学生的一句话
 * 结论），不落盘未成年人原始对话内容。
 */
@Injectable()
export class TutorService {
  private readonly provider: TutorProvider;
  private readonly sessions = new Map<string, TutorSessionRecord>();
  private readonly idempotency = new Map<string, CachedTurn>();
  private readonly auditLog: AuditEntry[] = [];

  /**
   * Provider 按 `QITU_DATA_MODE` 选择：
   * - `live`（默认）→ `GatewayTutorProvider`，走注册表里绑定的真实模型；
   * - `demo` / `test` → 确定性的 `HeuristicTutorProvider`。
   *
   * live 下若 `tutor.chat` 未绑定，由 provider 显式返回
   * `MODEL_NOT_CONFIGURED`，不会静默回落到 Heuristic。
   */
  constructor(
    @Inject(DATA_MODE_TOKEN) dataMode: DataMode,
    @Inject(ModelGateway) gateway: TutorModelGateway,
    @Optional() private readonly platformData?: PlatformDataService,
  ) {
    this.provider = createTutorProvider(dataMode, gateway);
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

  /**
   * 取（或惰性创建）某个项目**属于该学生**的会话。一个项目对应一个持续会话，
   * 这样掌握度阶梯可以跨刷新延续——学生重新打开页面时不会被「重置」。
   *
   * 对象级授权：如果该项目已存在属于**其他学生**的会话，抛统一 403，
   * 绝不返回该会话的任何字段。这样同一 `projectId` 无法被另一个学生取到。
   *
   * 注意：这里的归属只到「学生 ↔ 会话」这一层。等 `projects` 模块落地后，
   * 仍需在服务端校验 `project.studentUserId`，当前硬编码的 `DEMO_PROJECT`
   * 不是授权真相。
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

  /** 契约 `GetTutorSessionResponse` 投影；不含审计与内部字段。 */
  toSessionResponse(record: TutorSessionRecord): GetTutorSessionResponse {
    return {
      sessionId: record.sessionId,
      projectId: record.projectId,
      turns: record.turns,
      lastSeq: record.lastSeq,
    };
  }

  getSummary(sessionId: string, ownerId: string): TutorSessionSummary {
    const record = this.getSession(sessionId, ownerId);
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
   * 幂等：同一个 `idempotencyKey` 再次提交时重放缓存的事件序列，既不重新
   * 计算也不追加新回合。重放是**从头重放**，因为 SSE 客户端断线重连时会
   * 用同一个 key 重放整轮，前端依靠 `callId` 去重。
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

    const turnCount = record.turns.filter((turn) => turn.role === 'student').length;
    const input: TutorTurnInput = {
      projectId: record.projectId ?? DEMO_PROJECT.id,
      sessionId: record.sessionId,
      projectTitle: DEMO_PROJECT.title,
      projectStage: DEMO_PROJECT.stage,
      currentTaskTitle: DEMO_PROJECT.currentTaskTitle,
      previousHintLevel: record.lastHintLevel,
      turnCount,
      ...(request.content !== undefined ? { content: request.content } : {}),
      ...(request.pedagogicMove !== undefined ? { pedagogicMove: request.pedagogicMove } : {}),
      ...(request.optionLabel !== undefined ? { optionLabel: request.optionLabel } : {}),
    };

    // 学生回合先入账，seq 消耗 1 —— 这样前端本地回声也落在同一段区间里。
    const studentTurn: TutorTurn = {
      turnId: `${record.sessionId}:student:${record.lastSeq + 1}`,
      role: 'student',
      blocks: buildStudentBlocks(request),
      hintLevel: null,
      stageBefore: DEMO_PROJECT.stage,
      stageAfter: null,
      seq: (record.lastSeq += 1),
      createdAt: new Date().toISOString(),
      modality: 'text',
    };
    record.turns.push(studentTurn);

    const events: StreamedTutorEvent[] = [];
    let nextSeq = record.lastSeq;
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
      yield streamed;
    }

    record.lastSeq = nextSeq;
    record.turns.push({
      turnId: `${record.sessionId}:assistant:${record.lastSeq}`,
      role: 'assistant',
      blocks: assistantBlocks,
      hintLevel: assistantHintLevel,
      stageBefore: DEMO_PROJECT.stage,
      stageAfter: DEMO_PROJECT.stage,
      seq: record.lastSeq,
      createdAt: new Date().toISOString(),
      modality: 'text',
    });
    if (assistantHintLevel !== null) record.lastHintLevel = assistantHintLevel;
    this.trackStall(record, request.pedagogicMove);

    this.idempotency.set(request.idempotencyKey, {
      turnId: `${record.sessionId}:assistant:${record.lastSeq}`,
      events,
    });
    this.record({
      sessionId: record.sessionId,
      projectId: record.projectId,
      actorId: request.actorId,
      action: guardBlocked ? 'tutor.guard_block' : 'tutor.turn',
      detail: `回合 ${record.lastSeq}，提示等级 ${assistantHintLevel ?? '未变更'}`,
    });
    if (record.escalated) {
      this.record({
        sessionId: record.sessionId,
        projectId: record.projectId,
        actorId: 'system',
        action: 'tutor.escalate',
        detail: `连续 ${record.stallCount} 轮卡顿，建议班主任介入`,
      });
    }
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
    const turns: TutorTurn[] = [
      {
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
      },
      {
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
      },
      {
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
      },
    ];
    return {
      sessionId,
      ownerId,
      projectId,
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

  /** 连续 4 轮出现卡顿信号 → 升级给班主任（服务端判定，客户端不可写）。 */
  private trackStall(
    record: TutorSessionRecord,
    move: TutorTurnInput['pedagogicMove'],
  ): void {
    if (move === 'stall_signal') {
      record.stallCount += 1;
    } else if (move !== undefined) {
      record.stallCount = 0;
    }
    record.escalated = record.escalated || record.stallCount >= 4;
  }

  private record(entry: Omit<AuditEntry, 'at'>): void {
    this.auditLog.push({ at: new Date().toISOString(), ...entry });
    if (this.auditLog.length > 500) this.auditLog.splice(0, this.auditLog.length - 500);
  }
}

/**
 * 统一越权文案：不区分「非法角色」「不存在」「不属于你」，
 * 避免调用方通过响应差异探测会话是否存在或属于谁。
 */
const FORBIDDEN_MESSAGE = '无权访问该会话';

/** 断言会话归属；不一致统一 403，且不泄露任何会话字段。 */
function assertOwnedBy(record: TutorSessionRecord, ownerId: string): void {
  if (record.ownerId !== ownerId) throw new ForbiddenException(FORBIDDEN_MESSAGE);
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
