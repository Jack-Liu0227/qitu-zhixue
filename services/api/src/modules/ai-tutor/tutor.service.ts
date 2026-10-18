import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { QituSDKFactory } from '../qitu-sdk/qitu-sdk.service';
import {
  createNoopTutorContextReader,
  createNoopTutorDomainWriter,
  createTutorContextReader,
  createTutorDomainWriter,
  type TutorContextReader,
  type TutorDomainWriter,
  type TutorRuntimeContextMetadata,
} from '@qitu/ai-client';

import type {
  AdminTeamConfig,
  AdminTeamMember,
  CurrentUser,
  GetTutorSessionResponse,
  PblTeamWorkflowSpec,
  ProjectStage,
  TutorHintLevel,
  TutorIdeaCard,
  TutorPhaseProjection,
  TutorProjectContext,
  TutorSessionSummary,
  TutorTeamAgent,
  TutorTeamGraph,
  TutorTeamIdentity,
  TutorToolCall,
  TutorTurn,
  ExplorationView,
} from '@qitu/contracts';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { eq } from 'drizzle-orm';
import { adminTeamVersions, projectTemplates, projectTemplateVersions, pblGateEvidence } from '@qitu/database';
import { BUILTIN_ASSISTANTS, isObjectiveMastered } from '@qitu/ai-client';
import { findQuizBankEntryByConcept, toQuizBlockProjection } from '@qitu/ai-client/quiz-bank';
import { hashRequest, IdempotencyStore } from '../../common/idempotency';
import { AuditWriter } from '../../common/audit';
import {
  LEARNING_PROGRESS_STALL_SOURCE,
  LEARNING_STALL_ESCALATION_THRESHOLD,
  LearningStallSignalSink,
} from '../reminders/learning-stall-signal';
import { ModelGateway } from '../model-registry/model-gateway';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { ProjectsService } from '../projects/projects.service';
import { LearningPlanStore, type ObjectiveRecord } from '../learning-plan/learning-plan.store';
import { createTutorProvider, TUTOR_CHAT_USAGE, type TutorModelGateway } from './gateway-tutor.provider';
import { ImaMcpClient } from './ima-mcp.client';
import { buildTutorRuntimeBlocks, loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { TutorWorkspaceService } from './tutor-workspace.service';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { pblPhaseForProjectStage } from '../../common/pbl-phase';
import { ImaSettingsService } from '../platform-registry/ima-settings.service';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service';
import { TemplatesService } from '../templates/templates.service';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import { buildProjectInteractionBlocks } from './tutor-interactive-blocks';
import {
  buildRecommendationSignals,
  parseModelRecommendation,
  rankTemplateRecommendations,
  parseExtractedIntent,
  extractConservativeIntent,
  RECOMMENDATION_MAX_EMISSIONS,
  type RecommendationCandidate,
  type RecommendationSignals,
} from './tutor.recommendation';
import type { TemplateView } from '../templates/templates.types';
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
export interface TutorSessionRecord extends TutorSessionSnapshot {
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
    | 'tutor.guard_block'
    | 'tutor.recommendation';
  detail: string;
}

/** No-project sessions are exploration sessions; they never inherit a demo project. */
const EXPLORATION_CONTEXT = {
  title: '自由探索',
  stage: 'exploration' as ProjectStage,
};

const TUTOR_TURN_SCOPE = 'tutor.turn';
/** 判分答错时统一会话提示阶梯的封顶值（决策 D5）。 */
const MAX_QUIZ_HINT_LEVEL = 3;

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

/** PBL planning is meaningful only while a project is still active. */
const PBL_PLAN_STAGES = new Set<ProjectStage>([
  'intent_confirmed',
  'theory_learning',
  'theory_check',
  'practice_ready',
  'practice_building',
  'artifact_review',
  'reflection',
]);

function currentTaskFor(
  projectId: string | null,
  title: string,
  stage: ProjectStage,
): TutorProjectContext['currentTask'] {
  if (projectId === null || stage === 'exploration' || stage === 'completed' || stage === 'published') return null;
  return {
    id: `${projectId}-current-task`,
    title: `继续推进「${title}」`,
    detail: '打开项目查看当前阶段任务和下一步行动。',
    isTodayFocus: true,
  };
}

/** `AdminTeamMember.status` → 学生端可见的智能体状态。 */
function runtimeAgentIdsFor(assistantId: string): readonly string[] {
  // The runtime registry predates the admin assistant catalogue. This is an
  // identifier alias, not a display-name guess; all state still comes from the
  // project-scoped Team Runtime query.
  return assistantId === 'tutor-leader' ? ['qitu-learning-partner', 'tutor-leader'] : [assistantId];
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
  private readonly contextReader: TutorContextReader;
  private readonly domainWriter: TutorDomainWriter;

  private readonly sessions = new Map<string, TutorSessionRecord>();
  private readonly idempotency = new Map<string, CachedTurn>();
  private readonly intentExtractions = new Map<string, { goalUser: string; coreInterests: string[] } | null>();
  /**
   * A session has one authoritative sequence cursor. Serialize turns per
   * session so a disconnected/retried request cannot generate against the
   * same cursor and fail only after its reply has already been streamed.
   */
  private readonly turnLocks = new Map<string, Promise<void>>();
  private readonly auditLog: AuditEntry[] = [];
  private readonly store: TutorSessionStore;
  private readonly database: import('@qitu/database').Database | null;

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
    @Inject(DATA_MODE_TOKEN) private readonly dataMode: DataMode,
    @Inject(ModelGateway) private readonly gateway: TutorModelGateway,
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
    private readonly workspace?: TutorWorkspaceService,
    @Optional()
    @Inject(TutorSessionStore)
    store?: TutorSessionStore,
    @Optional()
    @Inject(IdempotencyStore)
    private readonly idempotencyStore?: IdempotencyStore,
    @Optional()
    @Inject(AuditWriter)
    private readonly auditWriter?: AuditWriter,
    @Optional() private readonly sdkFactory?: QituSDKFactory,
    @Optional() private readonly projects?: ProjectsService,
    @Optional() private readonly platformRegistry?: PlatformRegistryService,
    @Optional() private readonly teamRuntime?: TeamRuntimeService,
    @Optional() @Inject(LearningPlanStore) private readonly learningStore?: LearningPlanStore,
    @Optional() @Inject(ImaMcpClient) ima?: ImaMcpClient,
    @Optional() private readonly imaSettings?: ImaSettingsService,
    @Optional() private readonly managedKnowledge?: KnowledgeRetrievalService,
    @Optional() private readonly templates?: TemplatesService,
    @Optional() @Inject(DATABASE_TOKEN) database?: import('@qitu/database').Database | null,
    /** A1：模板绑定冻结快照解析；作为最后参数注入，保持既有位置化构造兼容。 */
    @Optional() private readonly templateBindings?: TemplateBindingService,
  ) {
    const runtime = loadTutorRuntimeSource();
    this.provider = createTutorProvider(dataMode, gateway, buildTutorRuntimeBlocks(runtime, []), ima);
    this.contextReader = this.workspace === undefined ? createNoopTutorContextReader() : createTutorContextReader(this.workspace);
    this.domainWriter = this.workspace === undefined ? createNoopTutorDomainWriter() : createTutorDomainWriter(this.workspace);
    this.store = store ?? new InMemoryTutorSessionStore();
    this.database = database ?? null;

  }

  /** Return the student's authorized project projection for the AI搭档 shell. */
  async getProjectContext(projectId: string | undefined, ownerId: string, explicitExploration = false, explorationId?: string): Promise<TutorProjectContext | null> {
    if (this.learningStore !== undefined) {
      const selected = projectId === undefined
        ? (await this.learningStore.listProjectsByStudent(ownerId)).find((project) => !['completed', 'published'].includes(project.status))
        : await this.learningStore.findProject(projectId);
      if (!selected) return explicitExploration && projectId === undefined
        ? this.buildExplorationContext(ownerId, await this.loadExploration(ownerId, explorationId))
        : null;
      if (selected.studentId !== ownerId) throw new ForbiddenException('无权访问该项目');
      const teamContext = await this.resolveTeamContext(selected.id, selected.templateVersionId, selected.status, ownerId);
      return {
        project: { id: selected.id, title: selected.title, stage: selected.status, progress: selected.progressPercent },
        progress: { currentStageIndex: selected.currentStageIndex, stageTotal: selected.stageTotal, progressPercent: selected.progressPercent },
        stages: PROJECT_STAGES,
        currentTask: currentTaskFor(selected.id, selected.title, selected.status),
        team: teamContext.team,
        phases: teamContext.phases,
      };
    }
    // Live teaching must never use the unrelated in-memory demo roster.
    if (this.dataMode === 'live') return explicitExploration && projectId === undefined
      ? this.buildExplorationContext(ownerId, await this.loadExploration(ownerId, explorationId))
      : null;
    if (this.platformData === undefined) return explicitExploration && projectId === undefined
      ? this.buildExplorationContext(ownerId, await this.loadExploration(ownerId, explorationId))
      : null;
    const projects = this.platformData.getProjectsByStudent(ownerId);
    const selected = projectId === undefined
      ? projects.find((project) => project.stage !== 'completed' && project.stage !== 'published')
      : this.platformData.getProject(projectId);

    if (selected === null || selected === undefined) return explicitExploration && projectId === undefined
      ? this.buildExplorationContext(ownerId, await this.loadExploration(ownerId, explorationId))
      : null;
    if (selected.studentId !== ownerId) throw new ForbiddenException('无权访问该项目');

    const stages = PROJECT_STAGES;
    const currentStageIndex = Math.max(0, stages.findIndex((stage) => stage.id === selected.stage));
    const teamContext = await this.resolveTeamContext(selected.projectId, null, selected.stage, ownerId);
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
      team: teamContext.team,
      phases: teamContext.phases,
    };
  }

  private async loadExploration(ownerId: string, explorationId?: string): Promise<ExplorationView | undefined> {
    if (explorationId === undefined || this.projects === undefined) return undefined;
    return this.projects.getExploration(ownerId, explorationId);
  }

  async getExplorationProjectContext(explorationId: string, ownerId: string): Promise<TutorProjectContext> {
    if (this.projects === undefined) throw new NotFoundException('探索会话不存在');
    const exploration = await this.projects.getExploration(ownerId, explorationId);
    return this.buildExplorationContext(ownerId, exploration);
  }

  private async buildExplorationContext(ownerId: string, exploration?: ExplorationView): Promise<TutorProjectContext> {
    const teamContext = await this.resolveTeamContext(
      exploration?.templateVersionId ? `exploration:${exploration.id}` : null,
      exploration?.templateVersionId ?? null,
      'exploration',
      ownerId,
    );
    return {
      // 探索会话没有项目：绝不返回哨兵项目，否则前端会拿 'exploration'
      // 当真实 projectId 去请求知识库与进度。身份仍由 team 携带。
      project: null,
      progress: { currentStageIndex: 0, stageTotal: PROJECT_STAGES.length, progressPercent: 0 },
      stages: PROJECT_STAGES,
      currentTask: null,
      team: teamContext.team,
      phases: [],
    };
  }
  /**
   * 解析当前会话的团队／助手身份与阶段投影（服务端事实，见
   * docs/design/20261018-tutor-workspace-interaction-contract.md §3）。
   *
   * - 自由探索：`assistantId = qitu-intake-assistant`，`teamId/teamName = null`；
   * - 正式项目：项目冻结的 `templateVersionId` 沿模板版本与模板表查到真实模板，
   *   再与 `admin_teams.pbl_spec.projectName/projectId` 绑定；助手取该团队 Leader。
   *
   * 注册表不可用时 fail-soft：返回基础身份与空阶段，不伪造团队名。
   */
  private async resolveTeamContext(
    projectId: string | null,
    templateVersionId: string | null,
    stage: ProjectStage,
    ownerId: string,
  ): Promise<{ team: TutorTeamIdentity; phases: TutorPhaseProjection[]; teamConfig: AdminTeamConfig | null }> {
    const intake = this.findBuiltinAssistant('qitu-intake-assistant');
    const fallback: TutorTeamIdentity = {
      teamId: null,
      teamName: null,
      assistantId: intake?.id ?? 'qitu-intake-assistant',
      assistantName: intake?.name ?? '启途智学助手',
      assistantAvatar: intake?.avatar ?? null,
    };
    if (this.platformRegistry === undefined) return { team: fallback, phases: [], teamConfig: null };
    try {
      // A1：正式项目优先按项目创建时冻结的绑定快照解析团队，退役/重新激活
      // 绑定不会改变既有项目。快照指向不可变的 teamVersionId，后写不会覆盖。
      const snapshot = projectId !== null && templateVersionId !== null && this.templateBindings !== undefined
        ? await this.templateBindings.resolveSnapshotForProject(projectId, templateVersionId, {
            id: ownerId,
            role: 'student',
            email: '',
            displayName: '',
          } satisfies CurrentUser)
        : null;
      if (projectId !== null && snapshot !== null) {
        const frozenTeam = await this.loadFrozenTeamVersion(snapshot.teamVersionId);
        if (frozenTeam !== null) {
          const assistants = await this.platformRegistry.listAssistants();
          const leaderId = frozenTeam.leaderAssistantId;
          const leader = assistants.find((candidate) => candidate.id === leaderId && candidate.enabled)
            ?? this.findBuiltinAssistant(leaderId);
          const team: TutorTeamIdentity = {
            teamId: frozenTeam.id,
            teamName: frozenTeam.name,
            assistantId: leader?.id ?? leaderId,
            assistantName: leader?.name ?? fallback.assistantName,
            assistantAvatar: leader?.avatar ?? null,
          };
          const phases = await this.projectPhases(frozenTeam, stage, ownerId);
          return { team, phases, teamConfig: frozenTeam };
        }
      }

      // 旧项目没有快照：保留原有解析路径，并写 legacy-resolution 审计（best-effort）。
      const [assistants, directTeam] = await Promise.all([
        this.platformRegistry.listAssistants(),
        templateVersionId === null || typeof this.platformRegistry.getTeamForTemplateVersion !== 'function'
          ? Promise.resolve(null)
          : this.platformRegistry.getTeamForTemplateVersion(templateVersionId),
      ]);
      let teamConfig = directTeam;
      if (teamConfig === null && templateVersionId !== null) {
        const [teams, binding] = await Promise.all([
          this.platformRegistry.listTeams(),
          this.findTemplateBinding(templateVersionId),
        ]);
        teamConfig = binding === null
          ? null
          : teams.find((team) => team.enabled && this.teamBindsTemplate(team, binding)) ?? null;
      }
      if (projectId !== null && teamConfig !== null && snapshot === null) {
        await this.writeLegacyResolutionAudit(projectId, templateVersionId, teamConfig, ownerId);
      }
      const leaderId = teamConfig?.leaderAssistantId ?? fallback.assistantId;
      const leader = assistants.find((candidate) => candidate.id === leaderId && candidate.enabled)
        ?? this.findBuiltinAssistant(leaderId);
      const team: TutorTeamIdentity = {
        teamId: projectId === null ? null : (teamConfig?.id ?? null),
        teamName: projectId === null ? null : (teamConfig?.name ?? null),
        assistantId: leader?.id ?? leaderId,
        assistantName: leader?.name ?? fallback.assistantName,
        assistantAvatar: leader?.avatar ?? null,
      };
      const phases = await this.projectPhases(teamConfig, stage, ownerId);
      return { team, phases, teamConfig };
    } catch {
      // 配置存储不可用时只返回真实存在的助手兜底，绝不编造团队名。
      return { team: fallback, phases: [], teamConfig: null };
    }
  }

  /** 按冻结的 teamVersionId 读不可变团队版本行，形变为 tutor 只读的 AdminTeamConfig。 */
  private async loadFrozenTeamVersion(teamVersionId: string): Promise<AdminTeamConfig | null> {
    if (this.database === null) return null;
    const [row] = await this.database
      .select()
      .from(adminTeamVersions)
      .where(eq(adminTeamVersions.id, teamVersionId))
      .limit(1);
    if (row === undefined) return null;
    const createdAt = row.createdAt.toISOString();
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      workspaceMode: row.workspaceMode as AdminTeamConfig['workspaceMode'],
      sessionMode: row.sessionMode as AdminTeamConfig['sessionMode'],
      leaderAssistantId: row.leaderAssistantId,
      members: (row.members ?? []) as readonly AdminTeamMember[],
      // 团队版本表没有并发列；tutor 只读团队身份/阶段，不消费该值。
      concurrencyLimit: 1,
      pblSpec: row.pblSpec as unknown as PblTeamWorkflowSpec | undefined,
      enabled: row.enabled,
      createdAt,
      updatedAt: createdAt,
    };
  }

  /** 旧项目无快照时的降级审计；不含学生文本，失败不影响读路径。 */
  private async writeLegacyResolutionAudit(
    projectId: string,
    templateVersionId: string | null,
    teamConfig: AdminTeamConfig,
    ownerId: string,
  ): Promise<void> {
    if (this.auditWriter === undefined) return;
    try {
      await this.auditWriter.write({
        actorId: ownerId,
        actorRole: 'student',
        action: 'tutor.team.legacy-resolution',
        targetType: 'project',
        targetId: projectId,
        detail: { projectId, templateVersionId, teamId: teamConfig.id, teamName: teamConfig.name },
      });
    } catch {
      // 审计失败不能把会话/项目上下文读接口打挂。
    }
  }

  private findBuiltinAssistant(id: string) {
    return BUILTIN_ASSISTANTS.find((assistant) => assistant.id === id);
  }

  private async findTemplateBinding(templateVersionId: string): Promise<{ id: string; title: string; slug: string } | null> {
    if (this.database === null) return null;
    const rows = await this.database
      .select({ id: projectTemplates.id, title: projectTemplates.title, slug: projectTemplates.slug })
      .from(projectTemplateVersions)
      .innerJoin(projectTemplates, eq(projectTemplateVersions.templateId, projectTemplates.id))
      .where(eq(projectTemplateVersions.id, templateVersionId))
      .limit(1);
    return rows[0] ?? null;
  }

  private teamBindsTemplate(team: AdminTeamConfig, binding: { id: string; title: string; slug: string }): boolean {
    const spec = team.pblSpec as (AdminTeamConfig['pblSpec'] & { projectName?: unknown; projectId?: unknown }) | undefined;
    return spec?.projectName === binding.title || spec?.projectId === binding.id;
  }

  private async projectPhases(teamConfig: AdminTeamConfig | null, stage: ProjectStage, ownerId: string): Promise<TutorPhaseProjection[]> {
    const spec = teamConfig?.pblSpec;
    if (!spec?.phases?.length) return [];
    const currentPhase = pblPhaseForProjectStage(stage);
    const phases = [...spec.phases];
    const currentIndex = Math.max(0, phases.findIndex((phase) => phase.phase === currentPhase));
    const satisfiedGates = await this.loadSatisfiedGatesForStudent(ownerId);
    return phases.map((phase, index) => {
      const status: TutorPhaseProjection['status'] =
        index < currentIndex ? 'completed' : index === currentIndex ? 'active' : 'locked';
      const gateRule = phase.gateCondition;
      const requiresGate = Boolean(gateRule);
      const gatePassed = gateRule !== undefined && satisfiedGates.has(gateRule);
      const assignedMember = teamConfig?.members.find((member) => member.assistantId === phase.assignedAssistantId);
      return {
        phaseId: phase.phase,
        orderIndex: index,
        name: phase.title,
        assignedAssistantName: assignedMember?.assistantName ?? phase.assignedRoleLabel ?? undefined,
        assignedRole: assignedMember?.role ?? null,
        ...(gateRule !== undefined ? { gateRule } : {}),
        requiresGateApproval: requiresGate,
        gateStatus: requiresGate ? (gatePassed ? 'passed' : 'pending') : 'not_required',
        status,
        requiredDeliverables: phase.deliverableType
          ? [{ id: `${phase.phase}:${phase.deliverableType}`, title: phase.deliverableType, submitted: false }]
          : [],
      };
    });
  }

  private async loadSatisfiedGatesForStudent(studentId: string): Promise<Set<string>> {
    if (this.database === null) return new Set();
    const rows = await this.database
      .select({ gate: pblGateEvidence.gate })
      .from(pblGateEvidence)
      .where(eq(pblGateEvidence.studentUserId, studentId));
    return new Set(rows.map((row) => row.gate));
  }

  /**
   * GET /api/v1/tutor/team-graph 的服务端实现：右侧栏「团队智能体」Tab 的
   * 只读数据源（合同见 packages/contracts TutorTeamGraph）。
   * 名册来自 admin_team_members 与 admin_assistants 的服务端目录；状态、任务、
   * mailbox 消息和工具事件来自项目范围内的 Team Runtime 安全投影。
   */
  async getTeamGraph(projectId: string, ownerId: string): Promise<TutorTeamGraph> {
    if (this.learningStore === undefined) throw new NotFoundException({ code: 'TUTOR_PROJECT_NOT_FOUND', message: '项目不存在' });
    const project = await this.learningStore.findProject(projectId);
    if (!project) throw new NotFoundException({ code: 'TUTOR_PROJECT_NOT_FOUND', message: '项目不存在' });
    if (project.studentId !== ownerId) throw new ForbiddenException({ code: 'TUTOR_PROJECT_FORBIDDEN', message: '无权访问该项目' });
    const { team, teamConfig } = await this.resolveTeamContext(project.id, project.templateVersionId, project.status, ownerId);
    const runtimeIds: Record<string, readonly string[]> = Object.fromEntries(
      (teamConfig?.members ?? []).map((member) => [member.assistantId, runtimeAgentIdsFor(member.assistantId)]),
    );
    const runtime = this.teamRuntime === undefined
      ? { runId: null, agents: {} }
      : await this.teamRuntime.getStudentTeamRuntimeProjection(project.id, ownerId, runtimeIds).catch(() => ({ runId: null, agents: {} }));
    const agents: TutorTeamAgent[] = (teamConfig?.members ?? []).map((member) => {
      const dynamic = runtime.agents[member.assistantId];
      return {
        slotId: member.slotId,
        assistantId: member.assistantId,
        name: member.assistantName,
        role: member.role,
        roleLabel: member.roleLabel ?? null,
        avatar: member.avatar ?? null,
        color: member.color ?? null,
        status: dynamic?.status ?? 'offline',
        currentTaskSummary: dynamic?.currentTaskSummary ?? null,
        pblPhase: member.pblPhase ?? null,
        messages: dynamic?.messages ?? [],
        toolCalls: dynamic?.toolCalls ?? [],
      };
    });
    return { team, runId: runtime.runId, agents };
  }

  private async resolveTurnAuthor(record: TutorSessionRecord, stage: ProjectStage): Promise<NonNullable<TutorTurn['author']>> {
    const intake = builtinAuthor('qitu-intake-assistant');
    try {
      let teamProjectId: string | null = record.projectId;
      let templateVersionId: string | null = null;
      if (record.projectId === null) {
        if (this.projects === undefined || record.explorationId === null || record.explorationId === undefined) return intake;
        const exploration = await this.projects.getExploration(record.ownerId, record.explorationId);
        templateVersionId = exploration.templateVersionId;
        if (templateVersionId === null) return intake;
        teamProjectId = `exploration:${record.explorationId}`;
      } else {
        const project = this.learningStore === undefined ? null : await this.learningStore.findProject(record.projectId);
        templateVersionId = project?.templateVersionId ?? null;
      }
      const context = await this.resolveTeamContext(teamProjectId, templateVersionId, stage, record.ownerId);
      if (context.team.teamId === null || context.teamConfig === null) return intake;
      const phaseId = pblPhaseForProjectStage(stage);
      const phase = context.teamConfig.pblSpec?.phases.find((candidate) => candidate.phase === phaseId);
      const member = phase === undefined
        ? context.teamConfig.members.find((candidate) => candidate.assistantId === context.teamConfig?.leaderAssistantId)
        : context.teamConfig.members.find((candidate) => candidate.assistantId === phase.assignedAssistantId);
      const authorId = phase?.assignedAssistantId ?? member?.assistantId ?? context.team.assistantId;
      const assistants = this.platformRegistry === undefined ? [] : await this.platformRegistry.listAssistants();
      const assistant = assistants.find((candidate) => candidate.id === authorId) ?? this.findBuiltinAssistant(authorId);
      return {
        id: authorId,
        name: member?.assistantName ?? assistant?.name ?? context.team.assistantName,
        role: member?.roleLabel ?? member?.role ?? assistant?.role ?? '导师',
        ...(assistant?.avatar ? { avatar: assistant.avatar } : {}),
        ...(member?.color ? { color: member.color } : {}),
      };
    } catch {
      return intake;
    }
  }

  private async updateExplorationIntent(
    record: TutorSessionRecord,
    currentMessage: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    const explorationId = record.explorationId;
    if (this.projects === undefined || explorationId == null) return;
    const sourceMessages = [
      ...record.turns.filter((turn) => turn.role === 'student').slice(-5).flatMap((turn) =>
        turn.blocks.filter((block): block is { kind: 'text'; text: string } => block.kind === 'text').map((block) => block.text),
      ),
      ...(currentMessage?.trim() ? [currentMessage.trim()] : []),
    ].slice(-6);
    if (sourceMessages.length === 0 || sourceMessages.some((message) => message.length > 2_000)) return;
    try {
      const exploration = await this.projects.getExploration(record.ownerId, explorationId);
      if (exploration.status === 'confirmed' || exploration.status === 'closed') return;
      let extracted: { goalUser: string; coreInterests: string[] } | null;
      if (this.durable && this.idempotencyStore !== undefined) {
        const extractionScope = `tutor.intent.extract:${hashRequest({ sessionId: record.sessionId })}`;
        const extractionKey = hashRequest({ idempotencyKey });
        const result = await this.idempotencyStore.execute<{ intent: { goalUser: string; coreInterests: string[] } | null }>(
          extractionScope,
          extractionKey,
          hashRequest({ sessionId: record.sessionId, explorationId, sourceMessages }),
          async () => ({ status: 200, body: { intent: await this.extractIntent(sourceMessages) } }),
          { processingLeaseMs: TUTOR_TURN_LEASE_MS },
        );
        extracted = result.body.intent;
      } else {
        const cacheKey = `${record.sessionId}:${idempotencyKey}`;
        if (this.intentExtractions.has(cacheKey)) {
          extracted = this.intentExtractions.get(cacheKey) ?? null;
        } else {
          extracted = await this.extractIntent(sourceMessages);
          this.intentExtractions.set(cacheKey, extracted);
          if (this.intentExtractions.size > 500) this.intentExtractions.delete(this.intentExtractions.keys().next().value!);
        }
      }
      if (extracted === null) return;
      const interestsChanged = extracted.coreInterests.length !== exploration.intentDraft?.coreInterests.length
        || extracted.coreInterests.some((interest, index) => interest !== exploration.intentDraft?.coreInterests[index]);
      const goalChanged = extracted.goalUser !== exploration.intentDraft?.goalUser;
      if (!interestsChanged && !goalChanged) return;
      await this.projects.updateIntentDraft(record.ownerId, explorationId, {
        goalUser: extracted.goalUser,
        coreInterests: extracted.coreInterests,
      });
    } catch {
      // Intent extraction/update is best-effort; it cannot fail a normal Tutor turn.
    }
  }

  private async extractIntent(sourceMessages: readonly string[]): Promise<{ goalUser: string; coreInterests: string[] } | null> {
    try {
      const result = await this.gateway.complete(TUTOR_CHAT_USAGE, {
        messages: [
          { role: 'system', content: '从学生自己的消息中提取结构化探索意图。goalUser 必须是消息中明确提及的服务对象，coreInterests 必须是原文中的兴趣词。只返回 JSON，且只能包含 goalUser 和 coreInterests；无法明确提取任一字段时返回空字段。不得推断或补造。' },
          { role: 'user', content: JSON.stringify({ studentMessages: sourceMessages }) },
        ],
        temperature: 0,
        maxTokens: 256,
        timeoutMs: 8_000,
      });
      return parseExtractedIntent(result.text, sourceMessages);
    } catch {
      return extractConservativeIntent(sourceMessages.join('\n'));
    }
  }

  /**
   * Recommendation is emitted only after the server-side intent gate is met.
   * The model can reorder server candidates, but never creates or authorizes IDs.
   */
  private async buildIdeaCards(record: TutorSessionRecord, currentStudentMessage?: string): Promise<TutorIdeaCard[]> {
    const explorationId = record.explorationId;
    if (this.templates === undefined || this.projects === undefined || explorationId == null) return [];
    const exploration = await this.projects.getExploration(record.ownerId, explorationId).catch(() => null);
    if (exploration === null || exploration.templateVersionId !== null) return [];
    const recentMessages = [
      ...record.turns
        .filter((turn) => turn.role === 'student')
        .slice(-5)
        .flatMap((turn) => turn.blocks.filter((block): block is { kind: 'text'; text: string } => block.kind === 'text').map((block) => block.text)),
      ...(currentStudentMessage?.trim() ? [currentStudentMessage.trim()] : []),
    ].slice(-6);
    const signals = buildRecommendationSignals(exploration, recentMessages);
    if (!signals.clarified) {
      await this.commitAudit({ sessionId: record.sessionId, projectId: null, actorId: 'system', action: 'tutor.recommendation', detail: JSON.stringify({ path: 'not_clarified', signals: signals.auditSignals }) });
      return [];
    }
    try {
      const actor = { id: record.ownerId, email: '', displayName: '', role: 'student' as const };
      const listed = await this.templates.listPublishedTemplates(actor);
      const ranked = rankTemplateRecommendations(signals, listed);
      const modelOrder = await this.recommendTemplateOrder(signals, ranked);
      const ordered = modelOrder === null
        ? ranked
        : modelOrder.flatMap((id) => ranked.filter((candidate) => candidate.template.id === id));
      const previousIds = new Set(record.turns.flatMap((turn) => turn.blocks.flatMap((block) => block.kind === 'idea_cards' ? block.cards.map((card) => card.templateId) : [])));
      const emissionCount = record.turns.filter((turn) => turn.blocks.some((block) => block.kind === 'idea_cards')).length;
      if (emissionCount >= RECOMMENDATION_MAX_EMISSIONS) return [];
      const cards: TutorIdeaCard[] = [];
      const verified: string[] = [];
      for (const candidate of ordered) {
        if (cards.length >= 3 || previousIds.has(candidate.template.id)) continue;
        const published = await this.templates.getPublishedTemplate(actor, candidate.template.id).catch(() => null);
        const card = published === null ? null : makeIdeaCard(published);
        if (card === null) {
          await this.commitAudit({ sessionId: record.sessionId, projectId: null, actorId: 'system', action: 'tutor.guard_block', detail: `推荐候选复核失败 templateId=${candidate.template.id}` });
          continue;
        }
        cards.push(card);
        verified.push(card.templateId);
      }
      await this.commitAudit({
        sessionId: record.sessionId,
        projectId: null,
        actorId: 'system',
        action: 'tutor.recommendation',
        detail: JSON.stringify({ path: modelOrder === null ? 'deterministic' : 'model_reranked', signals: signals.auditSignals, candidates: ranked.map(({ template, score, reasons }) => ({ templateId: template.id, score, reasons })), verified }),
      });
      return cards;
    } catch {
      await this.commitAudit({ sessionId: record.sessionId, projectId: null, actorId: 'system', action: 'tutor.recommendation', detail: '推荐目录不可用；未下发模板卡片' });
      return [];
    }
  }

  private async recommendTemplateOrder(signals: RecommendationSignals, candidates: readonly RecommendationCandidate[]): Promise<string[] | null> {
    if (candidates.length === 0) return null;
    try {
      const result = await this.gateway.complete(TUTOR_CHAT_USAGE, {
        messages: [
          { role: 'system', content: '只可从候选 templateId 中排序，返回 JSON {"templateIds":[...]}，不得创建 ID。' },
          { role: 'user', content: JSON.stringify({ goal: signals.goal, interests: signals.interests, candidates: candidates.map(({ template, score }) => ({ templateId: template.id, score })) }) },
        ],
        temperature: 0,
        maxTokens: 300,
        timeoutMs: 8_000,
      });
      return parseModelRecommendation(result.text, candidates);
    } catch {
      return null;
    }
  }

  /**
   * F1 判分路由的下发侧：仅在服务端拥有的 concept-mastery/theory 阶段，对
   * 当前计划中**第一个**尚未掌握的可量化（memory/procedure）理论目标，经
   * `mastery_objective_mappings` 反查稳定 conceptId，再选取不可变题库条目，
   * 只下发公开投影。`expectedKeys` / `explanation` 永不进入回合。
   * 本会话已下发过的题不重复追加（防重复推送同一道题）。
   */
  private async buildQuizBlocks(record: TutorSessionRecord, actorId: string): Promise<TutorTurn['blocks']> {
    if (record.projectId === null || this.learningStore === undefined) return [];
    try {
      const plan = (await this.learningStore.listPlansByStudent(actorId)).find(
        (candidate) => candidate.projectId === record.projectId,
      );
      if (plan === undefined || plan.studentUserId !== actorId) return [];
      // A8：只在与理论掌握相关的阶段下发；其余阶段不再夹带判断题。
      const project = await this.learningStore.findProject(record.projectId);
      const phase = project === null ? 'concept_mastery' : pblPhaseForProjectStage(project.status);
      if (phase !== 'concept_mastery') return [];
      const bundle = await this.learningStore.findBundle(plan.id);
      if (bundle === null) return [];
      const objectiveById = new Map(bundle.objectives.map((objective) => [objective.id, objective]));
      const ordered: ObjectiveRecord[] = [];
      for (const session of bundle.sessions.slice().sort((left, right) => left.index - right.index)) {
        for (const objectiveId of session.theoryObjectiveIds) {
          const objective = objectiveById.get(objectiveId);
          if (objective !== undefined && !ordered.some((item) => item.id === objectiveId)) ordered.push(objective);
        }
      }
      // 单目标下发：只取第一个未掌握的可量化理论目标。
      for (const objective of ordered) {
        if (objective.type !== 'memory' && objective.type !== 'procedure') continue;
        const mastery = await this.learningStore.findMastery(actorId, objective.id);
        if (mastery !== null && isObjectiveMastered(objective.type, {
          score: mastery.masteryBasisPoints / 10_000,
          qualitativeMastered: mastery.qualitativeMastered,
        })) continue;
        const mapping = await this.learningStore.findObjectiveMapping({
          planId: plan.id,
          objectiveId: objective.id,
          templateVersion: plan.templateVersion,
          contentVersion: plan.templateVersion,
        });
        if (mapping === null) continue;
        const entry = findQuizBankEntryByConcept(mapping.knowledgePointId);
        if (entry === null) continue;
        const alreadyEmitted = record.turns.some((turn) =>
          turn.blocks.some((block) => block.kind === 'quiz' && block.questionId === entry.questionId),
        );
        // 首个待掌握目标的题已下发过：不再重复推送，也不推进到第二个目标
        // （A5 只接受当前第一个待掌握目标）。本轮不追加新的 quiz block。
        if (alreadyEmitted) return [];
        return [toQuizBlockProjection(entry)];
      }
      return [];
    } catch {
      return [];
    }
  }

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
  getOrCreateSession(projectId: string | null, ownerId: string, explorationId?: string): TutorSessionRecord {
    const existing = [...this.sessions.values()].find(
      (session) => session.projectId === projectId && session.explorationId === (explorationId ?? null),
    );
    if (existing !== undefined) {
      assertOwnedBy(existing, ownerId);
      return existing;
    }
    const sessionId = projectId === null ? `exploration-${explorationId ?? ownerId}` : projectId === 'project-demo-001' ? 'session-demo-001' : `session-${projectId}`;
    const record = this.seedSession(sessionId, projectId, ownerId, explorationId);
    this.sessions.set(record.sessionId, record);
    this.record({
      sessionId: record.sessionId,
      projectId: record.projectId,
      actorId: ownerId,
      action: 'tutor.session_start',
      detail: projectId === null ? '学生开启自由探索会话' : '学生开启 AI搭档会话',
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
  async resolveSession(projectId: string | null, ownerId: string, explorationId?: string): Promise<TutorSessionRecord> {
    if (projectId !== null && (this.learningStore !== undefined || this.platformData !== undefined) && await this.getProjectContext(projectId, ownerId) === null) {
      throw new NotFoundException('项目不存在');
    }
    if (projectId === null && explorationId !== undefined) {
      if (this.projects === undefined) throw new NotFoundException('探索会话不存在');
      await this.projects.getExploration(ownerId, explorationId);
    }
    if (this.usesSeededMemory) {
      return this.getOrCreateSession(projectId, ownerId, explorationId);
    }
    const sessionId = projectId === null ? `exploration-${explorationId ?? ownerId}` : `session-${projectId}`;
    const existing = await this.store.findById(sessionId);
    if (existing !== null) {
      assertOwnedBy(existing, ownerId);
      return this.hydrate(existing);
    }
    if (projectId !== null) {
      const projectSession = await this.store.findByProject(projectId);
      if (projectSession !== null) {
        assertOwnedBy(projectSession, ownerId);
        return this.hydrate(projectSession);
      }
    }
    await this.domainWriter.initialize();
    const createdAt = new Date().toISOString();
    const source = projectId === null ? 'exploration' : 'project';
    await this.store.create({
      sessionId,
      ownerId,
      partnerId: this.contextReader.partner.id,
      projectId,
      explorationId: explorationId ?? null,
      source,
      createdAt,
    });
    const record = this.hydrate({
      sessionId,
      ownerId,
      projectId,
      explorationId: explorationId ?? null,
      source,
      createdAt,
      lastSeq: 0,
      turns: [],
    });
    await this.commitAudit({
      sessionId: record.sessionId,
      projectId: record.projectId,
      actorId: ownerId,
      action: 'tutor.session_start',
      detail: projectId === null ? '学生开启自由探索会话' : '学生开启 AI搭档会话',
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
  /** Read existing project session counts without creating empty sessions. */
  async getProjectSessionCounts(
    projectIds: readonly string[],
    ownerId: string,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const projectId of [...new Set(projectIds)].filter(Boolean).slice(0, 100)) {
      const snapshot = this.durable
        ? await this.store.findByProject(projectId)
        : [...this.sessions.values()].find((session) => session.projectId === projectId) ?? null;
      if (snapshot === null) {
        counts[projectId] = 0;
      } else {
        assertOwnedBy(snapshot, ownerId);
        counts[projectId] = snapshot.turns.length;
      }
    }
    return counts;
  }

  /** 契约 `GetTutorSessionResponse` 投影；不含审计与内部字段。 */
  toSessionResponse(record: TutorSessionRecord): GetTutorSessionResponse {
    return {
      sessionId: record.sessionId,
      projectId: record.projectId,
      explorationId: record.explorationId ?? null,
      source: record.source,
      context: {
        kind: record.source,
        label: record.source === 'exploration' ? '自由探索' : '项目学习',
        status: record.source === 'exploration' ? 'active' : 'confirmed',
        projectId: record.projectId,
      },
      turns: record.turns.map((turn) => toContractTurn(turn)),
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
   * 判分答错时推进统一会话提示阶梯（决策 D5，F1.7 path (a)）。
   *
   * 阶梯只在真正前进时追加一条合成助手 hint 回合，使 `last_seq` /
   * `lastHintLevel` 与 `GET /sessions/:id/summary` 保持一致；L3 封顶时
   * 不再追加回合（由判分服务发出卡点信号）。
   */
  async advanceQuizHint(
    record: TutorSessionRecord,
    actorId: string,
  ): Promise<{ hintLevel: TutorHintLevel; advanced: boolean }> {
    const releaseTurnLock = await this.acquireTurnLock(record.sessionId);
    try {
      if (this.durable) {
        const latest = await this.store.findById(record.sessionId);
        if (latest === null) throw new NotFoundException('会话不存在');
        assertOwnedBy(latest, actorId);
        const hydrated = this.hydrate(latest);
        Object.assign(record, hydrated);
        record.turns = hydrated.turns;
      }
      assertOwnedBy(record, actorId);
      const baseline = record.lastHintLevel === null ? 0 : Math.min(MAX_QUIZ_HINT_LEVEL, record.lastHintLevel);
      const next = Math.min(MAX_QUIZ_HINT_LEVEL, baseline + 1) as TutorHintLevel;
      const advanced = next > baseline;
      if (advanced) {
        const seq = record.lastSeq + 1;
        const hintTurn: TutorTurnRecord = {
          turnId: `${record.sessionId}:assistant:${seq}`,
          role: 'assistant',
          blocks: [{ kind: 'hint', level: next, text: '先说说你的思路，卡在哪一步了？' }],
          hintLevel: next,
          stageBefore: null,
          stageAfter: null,
          seq,
          createdAt: new Date().toISOString(),
          modality: 'text',
          author: builtinAuthor('qitu-learning-partner'),
          pedagogicMove: 'hint',
          expectedEvidence: null,
          promptVersion: this.contextReader.partner.promptVersion,
          evidenceRef: null,
        };
        if (this.durable) {
          await this.store.appendTurns({
            sessionId: record.sessionId,
            expectedLastSeq: record.lastSeq,
            newLastSeq: seq,
            turns: [hintTurn],
          });
        }
        record.lastSeq = seq;
        record.turns = [...record.turns, hintTurn];
        record.lastHintLevel = next;
      }
      return { hintLevel: next, advanced };
    } finally {
      releaseTurnLock();
    }
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
      onEvent?: (streamed: StreamedTutorEvent) => Promise<void> | void;
    },
  ): AsyncGenerator<StreamedTutorEvent, void, undefined> {
    const releaseTurnLock = await this.acquireTurnLock(record.sessionId);
    try {
      // A durable request may have waited behind another turn. Reload after
      // the wait so its sequence, history and idempotency hash use the latest
      // database snapshot rather than the controller's stale read.
      if (this.durable) {
        const latest = await this.store.findById(record.sessionId);
        if (latest === null) throw new NotFoundException('会话不存在');
        assertOwnedBy(latest, request.actorId);
        const hydrated = this.hydrate(latest);
        // Keep the caller's session object current as well. Controllers and
        // existing in-process consumers retain that object between turns.
        Object.assign(record, hydrated);
        record.turns = hydrated.turns;
      }

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
      for (const streamed of result.body.events) {
        await request.onEvent?.(streamed);
        yield streamed;
      }
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
      for (const streamed of cached.events) {
        await request.onEvent?.(streamed);
        yield streamed;
      }
      return;
    }

    const events = await this.executeTurn(record, request);
    this.idempotency.set(request.idempotencyKey, {
      turnId: `${record.sessionId}:assistant:${record.lastSeq}`,
      events,
    });
    for (const streamed of events) {
      await request.onEvent?.(streamed);
      yield streamed;
    }
    } finally {
      releaseTurnLock();
    }
  }

  private async acquireTurnLock(sessionId: string): Promise<() => void> {
    const previous = this.turnLocks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.turnLocks.set(sessionId, queued);
    await previous;
    return () => {
      release();
      if (this.turnLocks.get(sessionId) === queued) this.turnLocks.delete(sessionId);
    };
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
    // Team Runtime is an observability/delegation boundary. Tutor turns remain
    // usable when the optional runtime tables are not migrated yet; failures
    // are intentionally fail-closed and never expose student content.
    let teamRunId: string | null = null;
    if (this.teamRuntime !== undefined) {
      try {
        const run = await this.teamRuntime.startRun(
          { id: request.actorId, email: '', displayName: '', role: 'student' },
          {
            studentUserId: request.actorId,
            projectId: record.projectId,
            tutorSessionId: record.sessionId,
            trigger: 'tutor.turn',
            context: { turnCount, pedagogicMove: request.pedagogicMove ?? null },
            idempotencyKey: `tutor-team-run:${record.sessionId}:${request.idempotencyKey}`,
          },
        );
        teamRunId = typeof run.id === 'string' ? run.id : null;
      } catch {
        // Existing Tutor behavior must not regress because Team Runtime is
        // being rolled out independently from the conversation path.
      }
    }
    await this.domainWriter.initialize();
    const projectContext = record.projectId === null ? null : await this.getProjectContext(record.projectId, request.actorId);
    const liveProject = projectContext?.project ?? null;
    if (record.projectId !== null && this.learningStore !== undefined && !liveProject) throw new NotFoundException('项目不存在');
    const projectTitle = liveProject?.title ?? EXPLORATION_CONTEXT.title;
    const projectStage = liveProject?.stage ?? (record.projectId === null ? EXPLORATION_CONTEXT.stage : 'theory_learning');
    // Resolve once. The exact same phase assistant id drives display, knowledge access,
    // and every authorization check below; never re-route from the project title.
    const assistantAuthor = await this.resolveTurnAuthor(record, projectStage);
    const conversationAssistantId = assistantAuthor.id;
    const authorizeKnowledgeTool = this.imaSettings
      ? (toolId: string) => this.imaSettings!.canCall(this.contextReader.partner.id, toolId, conversationAssistantId)
      : undefined;
    const currentTask = currentTaskFor(record.projectId, projectTitle, projectStage);
    const currentTaskTitle = currentTask?.title ?? projectTitle;
    const partner = this.workspace === undefined
      ? this.contextReader.partner
      : await this.workspace.getPartnerProfile(this.contextReader.partner.id);
    // Team phase routing returns an admin assistant id (for example tutor-leader),
    // while the runtime registry may use its compatibility id (qitu-learning-partner).
    // Resolve the configured runtime from the routed assistant so model selection
    // follows the same mentor that authored the turn.
    let effectiveRuntime: Awaited<ReturnType<NonNullable<typeof this.platformRegistry>['getAgentRuntime']>> | null = null;
    if (this.platformRegistry !== undefined) {
      const runtimeCandidates = [...new Set([
        ...runtimeAgentIdsFor(conversationAssistantId),
        partner.id,
      ])];
      for (const runtimeAgentId of runtimeCandidates) {
        try {
          effectiveRuntime = await this.platformRegistry.getAgentRuntime(runtimeAgentId);
          break;
        } catch {
          // Intake or legacy assistants may not have a dedicated runtime row.
        }
      }
    }
    if (effectiveRuntime !== null) {
      partner.displayName = effectiveRuntime.agent.label;
      partner.roleDefinition = effectiveRuntime.agent.roleDefinition;
      partner.enabled = effectiveRuntime.agent.enabled;
      partner.promptVersion = effectiveRuntime.agent.promptVersion ?? partner.promptVersion;
      partner.capabilities = effectiveRuntime.agent.capabilities.filter((capability): capability is typeof partner.capabilities[number] =>
        capability === 'explore' || capability === 'plan' || capability === 'teach' || capability === 'review' || capability === 'reflect');
    }
    const configuredTutorAssistant = this.platformRegistry !== undefined
      && typeof this.platformRegistry.getTutorAssistantStatusById === 'function'
      ? await this.platformRegistry.getTutorAssistantStatusById(conversationAssistantId)
      : null;
    if (configuredTutorAssistant !== null && !configuredTutorAssistant.enabled) {
      throw new ConflictException({
        code: 'AGENT_ROLE_DISABLED',
        message: `当前阶段导师「${configuredTutorAssistant.name}」暂未启用`,
      });
    }
    const contextReader = this.workspace === undefined
      ? this.contextReader
      : createTutorContextReader(this.workspace, partner);
    if (!partner.enabled) throw new ConflictException({ code: 'AGENT_ROLE_DISABLED', message: 'AI 学习搭档当前不可用' });
    const contextPacket = await contextReader.buildContext({
      studentId: request.actorId,
      projectId: record.projectId,
      projectStage,
      currentGoal: currentTaskTitle,
      query: request.content ?? request.optionLabel ?? '当前学习任务',
      recentActivity: record.turns.slice(-6).map((turn) => `${turn.role}:${turn.blocks.length}个内容块`),
      recentMessages: record.turns.slice(-6).flatMap((turn) => {
        const content = turn.blocks
          .filter((block): block is { kind: 'text'; text: string } => block.kind === 'text')
          .map((block) => block.text)
          .join(' ')
          .trim();
        return content.length > 0 && (turn.role === 'student' || turn.role === 'assistant')
          ? [{ role: turn.role === 'student' ? 'user' as const : 'assistant' as const, content }]
          : [];
      }),
    });

    let knowledgeTools: TutorTurnInput['knowledgeTools'];
    let knowledgeState: string | undefined;
    if (this.managedKnowledge) {
      // Facts come from authorized manual bases, independent of project provisioning.
      contextPacket.knowledgeEvidence = [];
      knowledgeState = '仅引用实际检索或读取的资料；资料不足或未授权时明确说明，不得编造引用。';
      try {
        const result = await this.managedKnowledge.search(request.actorId, conversationAssistantId,
          request.content ?? request.optionLabel ?? currentTaskTitle);
        contextPacket.knowledgeEvidence = result.evidence.map(e => ({document: {
          id: e.citationId, version: e.indexVersionId, title: e.title, summary: e.text, content: e.text,
          source: `${e.knowledgeBase} · ${e.citationId}`, scope: 'system' as const, active: true, tags: [],
        }, score: e.score ?? 0, matchedTerms: []}));
        if (result.state !== 'CAPABILITY_NOT_AUTHORIZED')
          knowledgeTools = this.managedKnowledge.tools(request.actorId, conversationAssistantId);
      } catch {
        knowledgeState = '知识库本轮暂不可用，可以继续一般引导；不得声称已查证资料或编造引用。';
      }
    }

    if (effectiveRuntime !== null) {
      const mcpServers = await Promise.all(effectiveRuntime.mcpServers.map(async (server) => {
        if (!authorizeKnowledgeTool || server.serverId !== 'ima-knowledge') return server;
        const decisions = await Promise.all(server.toolIds.map(async (toolId) => ({ toolId, allowed: await authorizeKnowledgeTool(toolId) })));
        return { ...server, toolIds: decisions.filter((entry) => entry.allowed).map((entry) => entry.toolId) };
      }));
      contextPacket.runtime = {
        policyVersion: effectiveRuntime.policy.version,
        agentDefinition: effectiveRuntime.agent.agentDefinition,
        skills: effectiveRuntime.skills.map((skill) => ({ id: skill.id, version: skill.version, content: skill.content })),
        tools: effectiveRuntime.tools,
        mcpServers: mcpServers.filter((server) => server.toolIds.length > 0),
      } satisfies TutorRuntimeContextMetadata;
    }

    if (!contextPacket.partner.capabilities.includes('teach')) throw new ConflictException({ code: 'AGENT_CAPABILITY_DISABLED', message: 'AI 学习搭档当前不提供教学能力' });
    const useUnifiedSDK = this.sdkFactory !== undefined
      && (this.dataMode !== 'live' || effectiveRuntime === null || effectiveRuntime.agent.modelAvailable);
    const unifiedSDK = useUnifiedSDK ? this.sdkFactory!.create(
      { id: request.actorId, role: 'student', email: '', displayName: '' },
      { studentId: request.actorId, projectId: record.projectId },
      async (providerInput: TutorTurnInput, purpose) => {
        const generated: TutorStreamEvent[] = [];
        for await (const event of this.provider.generateTurn({
          ...providerInput,
          knowledgeTools, knowledgeState,
          authorizeKnowledgeTool,
          modelUsage: purpose.usageId,
          modelProviderId: effectiveRuntime?.agent.modelProviderId ?? undefined,
          modelId: effectiveRuntime?.agent.modelId ?? undefined,
        })) generated.push(event);
        return generated;
      },
      contextPacket.partner.modelUsage,
      effectiveRuntime === null
        ? undefined
        : effectiveRuntime.agent.modelProviderId !== null && effectiveRuntime.agent.modelId !== null
          ? { providerId: effectiveRuntime.agent.modelProviderId, modelId: effectiveRuntime.agent.modelId }
      : null,
    ) : undefined;
    if (unifiedSDK) {
      contextPacket.masterySnapshot = await unifiedSDK.mastery.snapshot({ validAt: new Date().toISOString(), knownAt: null });
    }

    const input: TutorTurnInput = {
      knowledgeTools, knowledgeState,
      authorizeKnowledgeTool,
      modelUsage: effectiveRuntime === null ? contextPacket.partner.modelUsage : 'agent.model',
      modelProviderId: effectiveRuntime?.agent.modelProviderId ?? undefined,
      modelId: effectiveRuntime?.agent.modelId ?? undefined,
      idempotencyKey: request.idempotencyKey,
      projectId: record.projectId ?? '',
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

    const promptVersion = contextPacket.partner.promptVersion;
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

    if (unifiedSDK) {
      const runtimeProgress: StreamedTutorEvent = {
        seq: ++nextSeq,
        event: { type: 'tool_call', callId: `agent-runtime-${record.sessionId}`, name: 'agent.runtime.run', label: '\u51c6\u5907\u6559\u5b66\u5f15\u5bfc\u56de\u590d' },
      };
      events.push(runtimeProgress);
    }
    const generated = unifiedSDK ? await unifiedSDK.agent.run(input) : this.provider.generateTurn(input);
    if (unifiedSDK) {
      const runtimeResult: StreamedTutorEvent = {
        seq: ++nextSeq,
        event: { type: 'tool_result', callId: `agent-runtime-${record.sessionId}`, status: 'done', result: '\u6559\u5b66\u8fd0\u884c\u65f6\u5df2\u51c6\u5907\u56de\u590d' },
      };
      events.push(runtimeResult);
    }
    for await (const event of generated) {
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
    const interactionBlocks = buildProjectInteractionBlocks(projectContext);
    for (const block of interactionBlocks) {
      assistantBlocks = [...assistantBlocks, block];
      events.push({ seq: ++nextSeq, event: { type: 'block', block } });
    }

    // Extraction is part of this idempotent turn and must precede recommendation lookup.
    if (record.projectId === null) {
      await this.updateExplorationIntent(record, request.content ?? request.optionLabel, request.idempotencyKey);
    }

    // F1 判分路由的下发侧：在助手回合持久化前，按计划未掌握理论目标追加交互题。
    const quizBlocks = await this.buildQuizBlocks(record, request.actorId);
    for (const block of quizBlocks) {
      assistantBlocks = [...assistantBlocks, block];
      events.push({ seq: ++nextSeq, event: { type: 'block', block } });
    }

    // 探索会话：意图记录达到澄清门槛后，由「启途智学助手」附上匹配并复核过的模板卡片。
    // 学生不点击就不创建项目；任何确认仍只经过 Projects 的 confirm-intent 链路。
    const ideaCards = record.projectId === null
      ? await this.buildIdeaCards(record, request.content ?? request.optionLabel)
      : [];
    if (ideaCards.length > 0) {
      const ideaBlock = { kind: 'idea_cards' as const, cards: ideaCards };
      assistantBlocks = [...assistantBlocks, ideaBlock];
      events.push({ seq: ++nextSeq, event: { type: 'block', block: ideaBlock } });
      // 块在 done 之后下发：客户端按 seq 追加到最新助手回合；刷新后以持久化回合为准。
    }
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
      author: assistantAuthor,
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
    await this.domainWriter.recordGrowthSignal({
      idempotencyKey: `tutor-turn:${record.sessionId}:${assistantSeq}`,
      studentId: request.actorId,
      projectId: record.projectId,
      kind: 'question_asked',
      summary: '学生完成了一次学习搭档对话回合',
      evidenceRef: `tutor_turn:${record.sessionId}:${assistantSeq}`,
      occurredAt: new Date().toISOString(),
    });
    if (this.teamRuntime !== undefined && teamRunId !== null) {
      try {
        await this.teamRuntime.recordEvent({
          runId: teamRunId,
          topic: 'tutor.turn.completed',
          payload: {
            studentUserId: request.actorId,
            projectId: record.projectId,
            sessionId: record.sessionId,
            assistantSeq,
            stage: projectStage,
            evidenceRef: `tutor_turn:${record.sessionId}:${assistantSeq}`,
          },
          idempotencyKey: `tutor-team-event:${record.sessionId}:${assistantSeq}`,
        });
        const delegationInput = buildTeamDelegationInput(record, request, assistantSeq, projectStage);
        const leaderActor = { id: request.actorId, email: '', displayName: '', role: 'student' as const };
        const tasks = record.projectId === null
          ? [
              {
                recipientAgentId: 'interest-confirmation',
                taskType: 'interest.confirm',
                input: {
                  studentId: request.actorId,
                  sessionId: record.sessionId,
                  turnCount: delegationInput.turnCount,
                  projectStage,
                  pedagogicMove: request.pedagogicMove ?? null,
                  // Never persist raw turns in Team Runtime. The child Agent
                  // receives only an approved metadata marker and evidence ref.
                  conversationSummary: delegationInput.summary,
                  evidenceRefs: delegationInput.evidenceRefs,
                },
              },
            ]
          : PBL_PLAN_STAGES.has(projectStage)
            ? [
              {
                recipientAgentId: 'pbl-orchestrator',
                taskType: 'pbl.plan',
                input: {
                  studentId: request.actorId,
                  projectId: record.projectId,
                  turnCount: delegationInput.turnCount,
                  pedagogicMove: request.pedagogicMove ?? null,
                  intent: delegationInput.summary,
                  currentStage: projectStage,
                  evidenceRefs: delegationInput.evidenceRefs,
                },
              },
            ]
            : [];
        for (const task of tasks) {
          await this.teamRuntime.delegateIfAvailable(leaderActor, teamRunId, {
            senderAgentId: 'qitu-learning-partner',
            recipientAgentId: task.recipientAgentId,
            taskType: task.taskType,
            input: task.input,
            idempotencyKey: `tutor-team-task:${record.sessionId}:${assistantSeq}:${task.taskType}`,
          });
        }
      } catch {
        // Outbox failure is observable separately; do not turn a successful
        // student conversation into HTTP 500 during a partial rollout.
      }
    }
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
    projectId: string | null,
    ownerId: string,
    explorationId?: string,
  ): TutorSessionRecord {
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    const seedStage = projectId === null ? EXPLORATION_CONTEXT.stage : 'theory_learning';
    const base: Omit<TutorTurnRecord, 'seq' | 'role' | 'blocks' | 'hintLevel' | 'stageBefore' | 'stageAfter' | 'turnId' | 'createdAt' | 'modality'> = {
      pedagogicMove: null,
      expectedEvidence: '找到 2 条证据，用自己的话说清楚光合作用。',
      promptVersion: this.contextReader.partner.promptVersion,
      evidenceRef: null,
    };
    const turns: TutorTurnRecord[] = [
      {
        ...base,
        turnId: `${sessionId}:student:1`,
        role: 'student',
        blocks: [{ kind: 'text', text: '老师让我们做校园植物观察手册，我不知道从哪开始。' }],
        hintLevel: null,
        stageBefore: seedStage,
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
        stageBefore: seedStage,
        stageAfter: seedStage,
        seq: 2,
        createdAt: at(-580_000),
        modality: 'text',
        author: builtinAuthor('tutor-leader'),
        pedagogicMove: 'hint',
      },
      {
        ...base,
        turnId: `${sessionId}:student:3`,
        role: 'student',
        blocks: [{ kind: 'text', text: '走廊那盆绿萝，放窗边就长得快，放教室后面就变黄。' }],
        hintLevel: null,
        stageBefore: seedStage,
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
        stageBefore: seedStage,
        stageAfter: seedStage,
        seq: 4,
        createdAt: at(-400_000),
        modality: 'text',
        author: builtinAuthor('tutor-leader'),
        pedagogicMove: 'hint',
      },
      {
        ...base,
        turnId: `${sessionId}:student:5`,
        role: 'student',
        blocks: [{ kind: 'text', text: '我觉得是光，光多它就长得好。' }],
        hintLevel: null,
        stageBefore: seedStage,
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
        stageBefore: seedStage,
        stageAfter: seedStage,
        seq: 6,
        createdAt: at(-180_000),
        modality: 'text',
        author: builtinAuthor('tutor-leader'),
        pedagogicMove: 'hint',
      },
    ];
    const seededTurns = projectId === null ? [] : turns;
    return {
      sessionId,
      ownerId,
      projectId,
      explorationId: explorationId ?? null,
      source: projectId === null ? 'exploration' : 'project',
      createdAt: at(-600_000),
      turns: seededTurns,
      lastSeq: seededTurns.length,
      lastHintLevel: projectId === null ? null : 2,
      stallCount: 0,
      escalated: false,
    };
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

function buildTeamDelegationInput(
  record: TutorSessionRecord,
  _request: { pedagogicMove?: TutorTurnInput['pedagogicMove'] },
  assistantSeq: number,
  projectStage: ProjectStage,
): { summary: string; evidenceRefs: string[]; turnCount: number } {
  return {
    // The worker can correlate this marker with authorized evidence refs. It
    // intentionally contains no student or assistant utterance.
    summary: `服务端已记录一次 ${projectStage} 阶段回合；请仅依据证据引用处理。`,
    evidenceRefs: [`tutor_turn:${record.sessionId}:${assistantSeq}`],
    turnCount: record.turns.filter((turn) => turn.role === 'student').length,
  };
}

export function makeIdeaCard(template: Awaited<ReturnType<TemplatesService['listPublishedTemplates']>>[number]): TutorIdeaCard | null {
  if (template.status !== 'published' || !template.latestPublishedVersionId) return null;
  const title = safeIdeaText(template.title, 120);
  const description = safeIdeaText(template.summary, 240);
  const rationale = safeIdeaText(template.learningObjectives[0] ?? template.summary, 240);
  const suggestedGoal = safeIdeaText(`完成「${template.title}」项目式学习`, 120);
  const suggestedInterest = safeIdeaText(template.domain ?? template.title, 24);
  if (!title || !description || !rationale || !suggestedGoal || !suggestedInterest) return null;
  const weeks: 4 | 8 = (template.estimatedDurationMinutes ?? 0) >= 960 ? 8 : 4;
  return {
    ideaId: `idea-${template.id}`,
    title,
    description,
    weeks,
    rationale,
    templateId: template.id,
    templateVersionId: template.latestPublishedVersionId,
    suggestedGoal,
    suggestedInterest,
    teamName: null,
  };
}

function safeIdeaText(value: string, maxLength: number): string | null {
  const text = value.trim();
  if (!text || text.length > maxLength) return null;
  if (/(?:直接答案|完整代码|原始参数|系统指令|提示词|system prompt|developer message)/i.test(text)) return null;
  return text;
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

function builtinAuthor(id: string): NonNullable<TutorTurn['author']> {
  const assistant = BUILTIN_ASSISTANTS.find((candidate) => candidate.id === id)
    ?? BUILTIN_ASSISTANTS.find((candidate) => candidate.id === 'qitu-intake-assistant');
  return {
    id: assistant?.id ?? id,
    name: assistant?.name ?? '启途智学助手',
    role: assistant?.role ?? 'Intake Guide / 启途智学助手',
    ...(assistant?.avatar ? { avatar: assistant.avatar } : {}),
  };
}
/** 剥离服务端专用元数据，只回契约字段。 */
export function toContractTurn(turn: TutorTurnRecord): TutorTurn {
  const {
    pedagogicMove: _pedagogicMove,
    expectedEvidence: _expectedEvidence,
    promptVersion: _promptVersion,
    evidenceRef: _evidenceRef,
    ...contract
  } = turn;
  // Persisted quiz blocks may contain answer-bearing fields from a future writer.
  // Until the server has an explicit `explain` action, rebuild the safe projection.
  const mayReleaseQuizAnswer = turn.pedagogicMove === 'explain';
  return {
    ...contract,
    blocks: contract.blocks.map((block) => {
      if (block.kind !== 'quiz' || mayReleaseQuizAnswer) return block;
      const { explanation: _explanation, graded: _graded, ...safeQuiz } = block;
      return {
        ...safeQuiz,
        options: safeQuiz.options.map(({ key, text }) => ({ key, text })),
      };
    }),
  };
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
