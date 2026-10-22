import type {
  ProjectStage,
  ProjectSummary,
  StageProgressDisplay,
  TemplateStage,
} from './project.js';
import type { OpticsExperimentMode, SavedWaveExperiment, WaveOpticsProjection } from './wave-optics.js';
import type { PblTemplateSession } from './pbl-learning.js';
import type { TutorLearningScope } from './tutor-learning.js';

/**
 * The pedagogic move a student requests through the tutor interaction. The client
 * only sends intent; the server records the final `pedagogic_move` value.
 */
export type PedagogicMove =
  | 'hint'
  | 'scaffold'
  | 'explain'
  | 'review_work'
  | 'debug_guide'
  | 'stall_signal';

/**
 * Hint ladder level (1–5).
 *
 * MUST stay in sync with the `TutorHintLevel` union declared in
 * `packages/ai-client/src/index.ts`. The two packages cannot import each other
 * (no workspace link exists), so the same literal union is duplicated in both
 * places.
 */
export type TutorHintLevel = 1 | 2 | 3 | 4 | 5;

/** Bounded citation metadata from an authorized read; never a document capability. */
export interface TutorLearningSource {
  sourceRef: string;
  title: string;
}

export type TutorOpeningBlock = { kind: 'learning_opening'; title: string; scenario: string; prompt: string; goal?: string } & (
  { mode: 'lesson'; scope: TutorLearningScope; lessonIndex: number; lessonCount: number }
  | { mode: 'exploration' | 'template' }
);

/**
 * A single structured reply block.
 *
 * Invariants:
 * - The hint level rises by at most one per turn (`hint` walks 1 → 2 → 3).
 * - Level 5 is reachable ONLY through the `explain` move; `hint`, `scaffold`,
 *   `review_work` and `debug_guide` must never produce level 5.
 * - A raw-markdown reply is not a valid `TutorReplyBlock`; every AI reply must
 *   be one of the five closed variants below so the frontend renders natively
 *   and the answer-leak path is narrowed by the type system.
 * - `stall_signal` feeds the 4-turn stall window and never produces a hint
 *   level by itself.
 */
export type TutorReplyBlock =
  | TutorOpeningBlock
  | { kind: 'text'; text: string }
  | { kind: 'questions'; items: string[] }
  | {
      kind: 'options';
      items: { label: string; text: string }[];
      allowOther: boolean;
    }
  | { kind: 'hint'; level: TutorHintLevel; text: string }
  | { kind: 'evidence'; ref: string }
  | { kind: 'learning_resource'; title: string; summary: string; sources: readonly TutorLearningSource[] }
  /**
   * 一次工具调用及其结果。
   *
   * 「先取上下文、再查提示阶梯、最后生成引导」这类步骤必须以可审计的
   * 独立单元呈现，而不是藏在模型的自然语言里——学生与家长都要能看见
   * AI 到底做了什么、依据是什么。
   */
  | { kind: 'tool'; call: TutorToolCall }
  /**
   * 模型思考过程 (Thinking scratchpad)，遵循启途 ModelThinkingCard 设计。
   * 包含思考内容及是否收拢闭合状态。
   */
  | { kind: 'think'; content: string; closed: boolean }
  /**
   * PBL 阶段指导卡片（基于启途课堂阶段理念）。
   */
  | {
      kind: 'pbl_card';
      phase: 'exploration' | 'concept_mastery' | 'guided_practice' | 'deliverable_review';
      title: string;
      teammateLabel?: string;
      summary: string;
      tags?: readonly string[];
      actionLabel?: string;
    }
  /**
   * 项目交付物与文件产出展示卡片（如实验报告、方案设计、分析代码、思维导图等）。
   */
  | {
      kind: 'artifact';
      fileName: string;
      fileType: 'markdown' | 'code' | 'document' | 'data' | 'image' | 'archive';
      title: string;
      summary?: string;
      content?: string;
      downloadUrl?: string;
      sizeText?: string;
      nodeRef?: string;
    }
  /**
   * 启发式题目与问答选择卡片。
   *
   * 选择题由服务端根据掌握度动态选取（见 `linkedConceptIds`），客户端
   * 只渲染与回传选择，**不判分、不生成选项**。
   *
   * 答案泄露红线：`explanation` 与正确选项在学生未达标或未显式请求
   * `explain` 之前不得下发；答错只给 `rationaleHint` 引导，不直接给答案。
   */
  | {
      kind: 'quiz';
      questionId: string;
      /** Server-owned scope for persisted dynamic questions; never inferred from labels. */
      sourceScope?: TutorQuestionSourceScope;
      assessmentMode?: 'formative';
      /** Authenticated owner projection; populated only after a persisted answer. */
      answer?: AnswerInteractiveQuizResponse;
      sourceRefs?: readonly string[];
      stem: string;
      type?: 'single' | 'multiple' | 'heuristic';
      options: { key: string; text: string; hint?: string }[];
      explanation?: string;
      selectedKey?: string;
      /** 关联的掌握度概念 id，服务端据此动态选题与回写掌握度。 */
      linkedConceptIds?: string[];
      /** 答错后的引导（不包含正确答案）。 */
      rationaleHint?: string;
      /** 已判分结果；未作答时缺省。由服务端写入，客户端不得自行推断。 */
      graded?: { correct: boolean; attempts: number; hintLevel: TutorHintLevel };
      /** 标记本题是否为 L3 答错后派生的降维微步题 */
      isDecomposed?: boolean;
      /** 注入自学生实测或仿真的上下文参数 */
      parameterContext?: Record<string, string | number>;
    }
  /**
   * 动态物理/算法参数探索实验卡片 (如动能定理控制变量法实验)。
   */
  | {
      kind: 'interactive_experiment';
      experimentId: string;
      title: string;
      summary?: string;
    }
  /**
   * 动态电路欧姆定律与串并联参数探索实验卡片。
   */
  | {
      kind: 'circuit_experiment';
      experimentId: string;
      title: string;
      summary?: string;
    }
  /**
   * 动态光学散射与单缝衍射物理参数探究卡片。
   */
  | {
      kind: 'optics_experiment';
      experimentId: string;
      title: string;
      summary?: string;
      initialMode?: OpticsExperimentMode;
      initialParameters?: Record<string, number>;
      allowedModels?: readonly OpticsExperimentMode[];
      specVersion: string;
      objectiveId: string;
      sessionIndex: number;
      allowedActions: readonly ('submit_prediction' | 'set_parameter' | 'run' | 'record_observation' | 'submit_evidence')[];
      scope?: {
        planId: string;
        planRevision: number;
        learningSessionId: string;
        activityId?: string;
        /** Actual frozen plan objective; block.objectiveId identifies the registered model domain. */
        objectiveId?: string;
        rubricRef: string;
        cerRef: string;
      };
      savedObservation?: TutorExperimentActionResponse['observationReceipt'];
      savedExperiment?: SavedWaveExperiment;
      predictionGate?: {
        required: boolean;
        submitted: boolean;
        hypothesis?: string;
      };
    }
  /**
   * 协诊导师旁白块：同一 Turn 内挂载非主讲导师的跨阶段诊断建议
   */
  | {
      kind: 'aside';
      copilot: {
        id: string;
        name: string;
        role: string;
        avatar?: string;
      };
      targetPhase: 'exploration' | 'concept_mastery' | 'guided_practice' | 'deliverable_review';
      content: string;
      evidenceRef?: string;
      proposalRef?: string;
      lesson?: { index: number; title: string };
    }
  /**
   * 学生或导师发送的图片与文件附件。
   */
  | {
      kind: 'attachment';
      fileName: string;
      fileType: 'image' | 'document' | 'code' | 'other';
      url: string;
      sizeText?: string;
      thumbnailUrl?: string;
    }
  /**
   * 对话内一键立项的想法卡片。
   *
   * 由「启途智学助手」在探索会话中输出；`templateId` 必须经服务端校验为
   * 存在且已发布的模板。学生**不点击就不创建**（未确认意图不得创建正式项目），
   * 助手不得代替学生触发确认。点击后走既有 `confirmExploration` 幂等接口。
   */
  /**
   * 白板式分步图示（OpenMAIC whiteboard 对应物）。
   *
   * 只读、逐步推进；**绝不携带脚本或任意 HTML**，只能是 mermaid/tex/svg
   * 三种受控形式之一，由服务端生成。
   */
  | {
      kind: 'board';
      provenance?: { origin: 'generated' | 'adapted'; sources: readonly TutorLearningSource[] };
      boardId: string;
      title?: string;
      steps: { caption: string; mermaid?: string; tex?: string; svg?: string }[];
    }
  /**
   * 阶段检查卡（里程碑）：当前阶段交付物与门禁状态。
   *
   * 所有状态只读自服务端门禁事实（`pbl_gate_evidence`）；客户端不得推算。
   * `TheoryMastered` 未过时不得出现实践类入口。
   */
  | {
      kind: 'milestone';
      phaseId: string;
      title: string;
      deliverables: { id: string; title: string; submitted: boolean }[];
      gate: {
        type: 'TheoryMastered' | 'review' | 'none';
        status: 'pending' | 'passed' | 'failed' | 'not_required';
      };
    }
  | { kind: 'idea_cards'; cards: TutorIdeaCard[] };

/** 一张可一键立项的想法卡片。 */
export interface TutorIdeaCard {
  /** 卡片内幂等标识，用于区分同一轮的多张卡片。 */
  ideaId: string;
  title: string;
  description: string;
  /** Lesson-based schedule selected for the idea. */
  lessonCount: number;
  lessonMinutes: 60 | 120;
  /** 为什么适合这个学生（适配理由）。 */
  rationale: string;
  /** 关联的项目模板 id；服务端校验存在且 published。 */
  templateId: string;
  /**
   * 已发布的模板**版本** id（`project_template_versions.id`）。
   *
   * 立项时必须回传它，服务端会重新校验「已发布 + 该学生可见」后冻结到
   * 项目上（`projects.template_version_id`）。只有 `templateId` 不够：
   * 团队身份与阶段投影都靠 `template_version_id` 解析，缺了它立项后
   * 拿不到导师团队。
   *
   * 客户端传什么不算数：服务端不得信任此值，必须自己重查。
   */
  templateVersionId: string;
  /** 卡片携带的建议目标，学生可在卡片内微调后确认。 */
  suggestedGoal: string;
  /** 卡片携带的建议兴趣，学生可在卡片内微调后确认。 */
  suggestedInterest: string;
  /** 关联团队名，例如「雷霆战机团队」，用于卡片上预告将唤醒的团队。 */
  teamName?: string | null;
}

/** 工具调用的生命周期状态。 */
export type TutorToolCallStatus = 'running' | 'done' | 'error';

/**
 * AI搭档在一次回复中调用的一次工具。
 *
 * `label` 是给学生看的短标签；`name` 是稳定的机器名，用于统计与排查。
 * `result` 只能是「面向学生的简短结论」，不得携带原始提示词、完整答案或
 * 任何未成年人原始对话。
 */
export interface TutorToolCall {
  callId: string;
  name: string;
  label: string;
  status: TutorToolCallStatus;
  result?: string;
}

/**
 * 输入通道：学生这一轮「怎么说」。
 *
 * - `text`：键盘／点选输入。
 * - `voice`：麦克风实时语音（Live）。
 */
export type TutorInputModality = 'text' | 'voice';

/**
 * 输出通道：AI 这一轮「怎么答」。
 *
 * - `text`：结构化回复块，渲染为界面上的文字、选项与工具调用时间线。
 * - `voice`：在文本块之外额外合成语音播放（TTS）。
 *
 * `voice` 是**叠加**在文本之上而不是替代文本：即使学生选了语音输出，
 * 界面仍保留完整文本，便于回看、复制与无障碍使用。
 */
export type TutorOutputModality = 'text' | 'voice';

/**
 * 学生可选的四种输入／输出组合。
 *
 * 「语音输入就语音输出、文本输入就文本输出」是两条默认路径；交叉组合
 * （语音入→文本出、文本入→语音出）同样开放，由学生自己选，服务端不强制。
 * 服务端只会拒绝**当前模型能力不支持**的组合（见 `ModelRuntimeResponse
 * .availableModalities`），并明确告知缺了什么。
 */
export type TutorModalityMode =
  | 'text_text'
  | 'voice_voice'
  | 'voice_text'
  | 'text_voice';

/**
 * 兼容字段：`TutorTurnModality` 等价于输入通道。
 *
 * 历史代码只用它表示「这一轮是打字还是说话」，保留别名以免大面积改名。
 * 新代码应优先使用 `TutorInputModality` / `TutorModalityMode`。
 */
export type TutorTurnModality = TutorInputModality;

export interface TutorProjectCurrentTask {
  id: string;
  title: string;
  detail?: string;
  isTodayFocus: boolean;
}

/** Server-owned project context projection used by the AI搭档 page. */
export interface TutorProjectContext {
  exploration?: {
    id: string | null;
    templateVersionId: string | null;
    title: string;
    drivingQuestion: string | null;
    handoff: 'free' | 'ready' | 'pending';
  };
  /**
   * 正式项目的摘要；**自由探索会话为 `null`**。
   *
   * 探索会话尚未创建项目（跨域硬规则：未确认意图不得创建正式项目），
   * 因此这里绝不返回哨兵/占位项目——否则前端会把不存在的 projectId
   * 当成真实项目去拉知识库与进度。判断「是否有项目」必须用本字段，
   * 不能用 `TutorProjectContext` 本身是否为 null（探索会话也有上下文，
   * 因为要携带 `team` 身份）。
   */
  project: ProjectSummary | null;
  progress: StageProgressDisplay;
  stages: TemplateStage[];
  currentTask: TutorProjectCurrentTask | null;
  /**
   * 服务端事实的团队／助手身份。
   *
   * 前端**不得**从项目标题正则推断团队名；未绑定时服务端返回
   * `{ assistantName: '启途智学助手' }` 且 `teamId` 为 `null`。
   */
  team?: TutorTeamIdentity;
  /** 来自 `PblTemplate.phases` 的真实阶段投影；无模板时为空数组。 */
  phases?: TutorPhaseProjection[];
  /** 当前冻结课时投影。阶段仅作为服务端策略元数据，不在学生端作为课程主轴展示。 */
  lesson?: {
    collaborationAvailable?: boolean;
    opening?: PblTemplateSession['opening'];
    learningGoal?: string;
    assessmentAvailable?: boolean;
    evidenceRefs?: readonly string[];
    completedCount?: number;
    currentActivity?: import('./learning-session-progress.js').LessonActivityProgress | null;
    planId?: string;
    planRevision?: number;
    learningSessionId?: string;
    roleSlotId?: string;
    assistantId?: string;
    objectiveId?: string | null;
    lessonIndex: number;
    lessonCount: number;
    title: string;
    status: 'current' | 'completed' | 'locked';
    checkpoint?: string | null;
  } | null;
}

/**
 * 当前会话由谁接管。
 *
 * 自由探索会话（无 projectId）只有 `assistantName`；正式项目会话额外携带
 * `teamId` / `teamName`，取自 `admin_teams` 与项目模板的绑定，不来自标题猜测。
 */
export interface TutorTeamIdentity {
  /** `admin_teams.id`；自由探索会话为 `null`。 */
  teamId: string | null;
  /** 团队展示名，例如「雷霆战机团队」；自由探索会话为 `null`。 */
  teamName: string | null;
  /** 本轮接管的助手 id（Leader 或探索助手）。 */
  assistantId: string;
  /** 本轮接管的助手展示名，例如「启途智学助手」「启途总导师」。 */
  assistantName: string;
  /** 助手头像，支持 emoji、asset: 素材引用及兼容图片 URL；缺省采用默认头像。 */
  assistantAvatar?: string | null;
}

/** 项目模板阶段（`PblPhaseSpec`）的只读投影，用于右侧栏「项目进度」Tab。 */
export interface TutorPhaseProjection {
  phaseId: string;
  orderIndex: number;
  name: string;
  /** 该阶段的责任助手展示名；缺省时前端显示「未指派」。 */
  assignedAssistantName?: string | null;
  assignedRole?: 'leader' | 'coach' | 'teammate' | 'reviewer' | null;
  gateRule?: string;
  requiresGateApproval: boolean;
  /** 门禁当前核验结果，只读自服务端事实。 */
  gateStatus: 'pending' | 'passed' | 'failed' | 'not_required';
  /** 当前阶段整体状态。 */
  status: 'locked' | 'active' | 'completed';
  requiredDeliverables: { id: string; title: string; submitted: boolean }[];
}

/** 团队智能体运行状态（右侧栏「团队智能体」Tab）。 */
export type TutorTeamAgentStatus = 'ready' | 'running' | 'waiting' | 'failed' | 'offline';

export interface TutorLessonCollaborationView {
  projectId: string;
  scope: TutorLearningScope;
  status: 'unavailable' | 'idle' | 'queued' | 'running' | 'ready' | 'failed';
  blocks: readonly TutorReplyBlock[];
}

/** 智能体参与的一次可见对话事件（已服务端过滤脱敏，不含内部提示词）。 */
export interface TutorTeamAgentMessage {
  messageId: string;
  /** 面向学生的简短内容摘要，不是原始 prompt／原始参数。 */
  summary: string;
  direction: 'inbound' | 'outbound';
  createdAt: string;
}

/** 智能体的一次工具调用（面向学生的标签与结论）。 */
export interface TutorTeamAgentToolCall {
  callId: string;
  /** 稳定机器名，用于排查。 */
  name: string;
  /** 给学生看的短标签。 */
  label: string;
  status: TutorToolCallStatus;
  /** 面向学生的结论摘要；不得包含内部提示词或原始参数。 */
  summary?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

/** 团队里一个智能体的投影。 */
export interface TutorTeamAgent {
  /** `admin_team_members.slot_id`。 */
  slotId: string;
  assistantId: string;
  name: string;
  role: string;
  /** 角色中文标签，例如「概念教练 (核心原理解析)」。 */
  roleLabel?: string | null;
  avatar?: string | null;
  color?: string | null;
  status: TutorTeamAgentStatus;
  /** 当前正在做的事的一句话摘要；空闲时为 `null`。 */
  currentTaskSummary?: string | null;
  /** 绑定的 PBL 阶段，例如 `concept_mastery`。 */
  pblPhase?: string | null;
  messages: TutorTeamAgentMessage[];
  toolCalls: TutorTeamAgentToolCall[];
}

/**
 * GET /api/v1/tutor/team-graph
 *
 * 仅对已授权的 `projectId`／`sessionId` 开放。浏览器只读渲染，
 * 不得用图数据绕过授权或直接写状态。
 */
export interface TutorTeamGraph {
  team: TutorTeamIdentity;
  runId: string | null;
  agents: TutorTeamAgent[];
}


export type TutorSessionSource = 'project' | 'exploration';

export interface TutorContextProgress {
  kind: TutorSessionSource;
  label: string;
  status: 'active' | 'awaiting_confirmation' | 'confirmed';
  projectId: string | null;
}

export type TutorFeedbackKind = 'helpful' | 'confusing' | 'stuck';

/** POST /tutor/sessions */
export interface CreateTutorSessionRequest {
  /** Project sessions carry a projectId; exploration sessions omit it. */
  projectId?: string;
  explorationId?: string;
  source: TutorSessionSource;
  idempotencyKey: string;
}

export interface CreateTutorSessionResponse {
  sessionId: string;
  projectId: string | null;
  explorationId: string | null;
  source: TutorSessionSource;
  createdAt: string;
  lastSeq: number;
  context: TutorContextProgress;
}

/** GET /tutor/sessions/:id */
export interface TutorTurn {
  turnId: string;
  role: 'student' | 'assistant';
  blocks: TutorReplyBlock[];
  hintLevel: TutorHintLevel | null;
  stageBefore: ProjectStage | null;
  stageAfter: ProjectStage | null;
  seq: number;
  createdAt: string;
  /** 该轮的**输入**通道。 */
  modality: TutorTurnModality;
  /**
   * 该轮的**输出**通道。
   *
   * 旧数据可能缺省；缺省时前端按 `text` 渲染，不自行推断。
   */
  outputModality?: TutorOutputModality;
  /**
   * 发布该轮回复的智能体/子导师元数据。
   *
   * 用于多 Agent 协作时区分总导师、概念教练、仿真向导、评审导师或启途智学助手。
   */
  author?: {
    id: string;
    name: string;
    role: string;
    avatar?: string;
    color?: string;
  };
  attachments?: {
    id: string;
    name: string;
    type: 'image' | 'file';
    url: string;
    sizeText?: string;
  }[];
}

export interface GetTutorSessionResponse {
  sessionId: string;
  projectId: string | null;
  explorationId: string | null;
  source: TutorSessionSource;
  context: TutorContextProgress;
  turns: TutorTurn[];
  lastSeq: number;
}

/** POST /tutor/sessions/:id/turns */
export interface CreateTutorTurnRequest {
  content?: string;
  pedagogicMove?: PedagogicMove;
  optionLabel?: string;
  /**
   * 学生本轮选择的输入／输出组合。缺省为 `text_text`。
   *
   * 请求里出现语音通道（`voice_*`）时，服务端会再次校验 Live 模型能力，
   * 不支持的组合返回 `MODALITY_UNAVAILABLE`，不会静默降级成别的通道。
   */
  modalityMode?: TutorModalityMode;
  idempotencyKey: string;
}

export interface CreateTutorTurnResponse {
  turnId: string;
  seq: number;
  accepted: true;
}

/** GET /tutor/sessions/:id/summary */
export interface TutorSessionSummary {
  summary: string;
  lastHintLevel: TutorHintLevel | null;
  stallCount: number;
  escalated: boolean;
}

/** POST /tutor/sessions/:id/feedback */
export interface CreateTutorFeedbackRequest {
  turnId: string;
  kind: TutorFeedbackKind;
  note?: string;
  idempotencyKey: string;
}

export interface CreateTutorFeedbackResponse {
  accepted: true;
}

/** POST /tutor/sessions/:id/interactive/experiments/:experimentId/action */
export type TutorExperimentAction = 'submit_prediction' | 'run' | 'record_observation';

export interface TutorExperimentActionRequest {
  action: TutorExperimentAction;
  payload?: unknown;
  idempotencyKey: string;
}

export interface TutorExperimentActionResponse {
  accepted: true;
  actionId: string;
  experimentId: string;
  action: TutorExperimentAction;
  /** Optional server-computed model projection for a run action. */
  simulationResult?: { mode: OpticsExperimentMode; summary: string; waveProjection?: WaveOpticsProjection };
  /** Returned only after the works evidence owner has persisted and read back the observation. */
  observationReceipt?: {
    observationId: string;
    experimentId: string;
    evidenceRef: string;
    projectId: string;
    sessionId: string;
    planId: string;
    planRevision: number;
    learningSessionId: string;
    activityId?: string;
    runActionId: string;
    objectiveId?: string;
    parameterDigest: string;
    provenance: 'simulated_observation';
    rubricRef: string;
    cerRef: string;
    savedAt: string;
  };
}

/**
 * POST /api/v1/tutor/sessions/:id/interactive/:quizId/answer
 *
 * 交互题作答。**判分只发生在服务端**（mastery/题库领域 owner 校验后才成为
 * 正式掌握度事实）；同一 `idempotencyKey` 重复提交不得重复计分。
 */
export interface AnswerInteractiveQuizRequest {
  /** 学生选择的选项 key（多选时为多个）。 */
  selectedKeys: string[];
  idempotencyKey: string;
}

export interface AnswerInteractiveQuizResponse {
  quizId: string;
  /** Generated practice is feedback evidence and cannot grant mastery. */
  assessmentMode?: 'formative';
  /** Persisted selected option IDs, available only to the owning student after submission. */
  selectedKeys?: string[];
  correct: boolean;
  /** 该题累计作答次数（含本次）。 */
  attempts: number;
  /** 作答后该概念的提示阶梯等级。 */
  hintLevel: TutorHintLevel;
  /** Reviewed bank questions require an explicit explain request after answering.
   * Generated formative questions return their complete explanation upon submission. */
  explanation: string | null;
  correctKeys: string[] | null;
  /** 关联概念的掌握度变化投影；无变化时为空数组。 */
  conceptDeltas: { conceptId: string; before: number; after: number; mastered: boolean }[];
  /** 下一步引导（不含答案）。 */
  nextGuidance?: string | null;
  /** 幂等重放标记：true 表示本次是重放，未重复计分。 */
  replayed: boolean;
}

/** A generated question belongs to one project, plan revision, lesson and tutor conversation. */
export interface TutorQuestionSourceScope {
  projectId: string;
  planId: string;
  planRevision: number;
  learningSessionId: string;
  objectiveId: string;
  tutorSessionId: string;
}
