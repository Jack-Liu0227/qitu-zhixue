import type { ProjectStage } from './project';

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
 * AI 搭档在一次回复中调用的一次工具。
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

/** How a turn was submitted. */
export type TutorTurnModality = 'text' | 'voice';

/** Whether a tutor session is bound to a project or unbound. */
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
  modality: TutorTurnModality;
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
