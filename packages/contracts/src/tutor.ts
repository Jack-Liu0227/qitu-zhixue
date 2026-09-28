import type {
  ProjectStage,
  ProjectSummary,
  StageProgressDisplay,
  TemplateStage,
} from './project';

/**
 * The pedagogic move a student requests through the six capability entries on
 * the AI搭档 page. The client only sends intent; the server records the final
 * `pedagogic_move` value.
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
  | { kind: 'text'; text: string }
  | { kind: 'questions'; items: string[] }
  | {
      kind: 'options';
      items: { label: string; text: string }[];
      allowOther: boolean;
    }
  | { kind: 'hint'; level: TutorHintLevel; text: string }
  | { kind: 'evidence'; ref: string }
  /**
   * 一次工具调用及其结果。
   *
   * 「先取上下文、再查提示阶梯、最后生成引导」这类步骤必须以可审计的
   * 独立单元呈现，而不是藏在模型的自然语言里——学生与家长都要能看见
   * AI 到底做了什么、依据是什么。
   */
  | { kind: 'tool'; call: TutorToolCall };

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
  project: ProjectSummary;
  progress: StageProgressDisplay;
  stages: TemplateStage[];
  currentTask: TutorProjectCurrentTask | null;
}


export type TutorSessionSource = 'project' | 'unbound';

export type TutorFeedbackKind = 'helpful' | 'confusing' | 'stuck';

/** POST /tutor/sessions */
export interface CreateTutorSessionRequest {
  /** Omit to create an unbound (no-project) session. */
  projectId?: string;
  source: TutorSessionSource;
  idempotencyKey: string;
}

export interface CreateTutorSessionResponse {
  sessionId: string;
  projectId: string | null;
  createdAt: string;
  lastSeq: number;
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
}

export interface GetTutorSessionResponse {
  sessionId: string;
  projectId: string | null;
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
