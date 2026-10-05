import type {
  PedagogicMove,
  ProjectStage,
  TutorHintLevel,
  TutorReplyBlock,
} from '@qitu/contracts';
import type { TutorContextPacket } from '@qitu/ai-client';

/**
 * AI搭档的回合引擎接口（provider seam）。
 *
 * 默认实现 `HeuristicTutorProvider` 完全本地、确定、无需任何外部 API Key。
 * 换成一个真实模型只需实现本接口：上层（service / controller / SSE）不需要
 * 任何改动。契约与流式事件是与前端共享的，换实现不会改变线上协议。
 */
export interface TutorTurnInput {
  projectId: string;
  sessionId: string;
  projectTitle: string;
  projectStage: ProjectStage;
  currentTaskTitle: string;
  content?: string;
  pedagogicMove?: PedagogicMove;
  optionLabel?: string;
  /** 本会话此前已达到的最高提示等级；null 表示还没有提示。 */
  previousHintLevel: TutorHintLevel | null;
  /** 本会话已出现的轮次数，用于卡顿窗口判断。 */
  turnCount: number;
  /** Runtime-resolved model purpose; never supplied by the browser. */
  modelUsage?: string;
  modelProviderId?: string;
  modelId?: string;
  /** Server-owned replay key used by the SDK/runtime boundary. */
  idempotencyKey?: string;
  /** Server-assembled context from the Tutor SDK; never supplied by the client. */
  contextPacket?: TutorContextPacket;
}

/**
 * 模型链路不可用时的稳定错误码。
 *
 * 这是**可识别的错误语义**：调用方据此区分「还没配置模型」与「模型暂时
 * 不可用 / 本轮调用失败」，绝不会把这些情况静默降级成 Heuristic/demo 回复。
 */
export type TutorModelErrorCode =
  /** Agent 未配置模型，或供应商 / 模型 / 凭证不可用。 */
  | 'MODEL_NOT_CONFIGURED'
  /** 上游超时 / 网络错误 / 5xx 等可重试故障。 */
  | 'MODEL_UNAVAILABLE'
  /** 其它调用失败（响应不可解析、空文本、被取消等）。 */
  | 'MODEL_CALL_FAILED';

export type TutorStreamEvent =
  | { type: 'tool_call'; callId: string; name: string; label: string }
  | {
      type: 'tool_result';
      callId: string;
      status: 'done' | 'error';
      result: string;
    }
  | { type: 'delta'; text: string }
  | { type: 'block'; block: TutorReplyBlock }
  /**
   * 本轮没有产生任何引导文本时的显式失败信号。
   *
   * 只承载**已脱敏**的稳定错误码与面向学生的短句，绝不包含 API Key、
   * 上游原始响应体或未成年人原始对话。SSE 层把它映射成 `error` 帧。
   */
  | {
      type: 'error';
      code: TutorModelErrorCode;
      message: string;
      retryable: boolean;
    }
  | { type: 'done'; turnSummary: { hintLevel: TutorHintLevel | null; stage: ProjectStage } };

export interface TutorProvider {
  generateTurn(input: TutorTurnInput): AsyncGenerator<TutorStreamEvent, void, undefined>;
}

/* ------------------------------------------------------------------ *
 * 提示阶梯策略（与服务端 policy 常量保持一致）
 * ------------------------------------------------------------------ */

/** 阶梯下限。每个新问题从这里开始。 */
export const HINT_LEVEL_MIN: TutorHintLevel = 1;
/** 阶梯上限（5 = 必要解释）。 */
export const HINT_LEVEL_MAX: TutorHintLevel = 5;
/** `hint` / `debug_guide` 最多爬到第 3 档。 */
export const HINT_PATH_MAX_LEVEL: TutorHintLevel = 3;
/** `scaffold` 渲染第 4 档（2–6 步，每步一个目标）。 */
export const SCAFFOLD_LEVEL: TutorHintLevel = 4;
/** 第 5 档只能由 `explain` 产生。 */
export const EXPLAIN_ONLY_LEVEL: TutorHintLevel = 5;
/** 每轮最多上升一档，不允许跳档。 */
export const MAX_HINT_RISE_PER_TURN = 1;
/** 连续引导上限：第 7 轮起不再继续上升。 */
export const CONTINUOUS_GUIDANCE_TURN_CAP = 6;

/**
 * 本轮应当达到的提示等级。
 *
 * 这是唯一的等级决策点：`hint` / `debug_guide` 每轮最多 +1 且不超过第 3 档；
 * `scaffold` 固定第 4 档；`explain` 是唯一能到第 5 档的入口；`review_work`
 * 与 `stall_signal` 不改变等级。任何「一次跳到第 5 档」的路径在这里被挡住。
 */
export function selectHintLevel(
  move: PedagogicMove | undefined,
  previous: TutorHintLevel | null,
  turnCount: number,
): TutorHintLevel | null {
  switch (move) {
    case 'scaffold':
      return SCAFFOLD_LEVEL;
    case 'explain':
      return EXPLAIN_ONLY_LEVEL;
    case 'review_work':
    case 'stall_signal':
      return previous;
    case 'hint':
    case 'debug_guide':
      return riseFrom(previous, turnCount);
    default:
      // 纯文字提问也走引导路径：默认从第 1 档开始，之后每轮最多 +1。
      return riseFrom(previous, turnCount);
  }
}

function riseFrom(previous: TutorHintLevel | null, turnCount: number): TutorHintLevel {
  if (turnCount >= CONTINUOUS_GUIDANCE_TURN_CAP && previous !== null) return previous;
  if (previous === null) return HINT_LEVEL_MIN;
  const risen = Math.min(previous + MAX_HINT_RISE_PER_TURN, HINT_PATH_MAX_LEVEL);
  return Math.max(previous, risen) as TutorHintLevel;
}

/* ------------------------------------------------------------------ *
 * 答案泄露防护
 * ------------------------------------------------------------------ */

/**
 * 会让学生直接拿到结论的措辞。命中即视为「泄露完整答案」，必须改写。
 * 这不是分类器，是一道确定性的最后闸门：真实模型接进来以后它依然生效。
 */
const ANSWER_LEAK_MARKERS = [
  '答案是',
  '答案就是',
  '正确答案',
  '结论是',
  '所以说，答案',
  '直接告诉你',
  '标准答案',
];

/** 引导档（1–4）里，回复必须是启发式的：以问句收尾。 */
const SOCRATIC_TAIL = /[?？]\s*$/;

export interface AnswerLeakVerdict {
  ok: boolean;
  reason?: string;
  /** 直接被拒时的改写稿；仍然只包含启发式内容。 */
  replacement?: string;
}

/**
 * 对最终回复做答案泄露校验。
 *
 * 规则：
 * - 命中 `ANSWER_LEAK_MARKERS` → 失败，给出启发式改写稿。
 * - 第 1–4 档必须以问句收尾（苏格拉底式），并且不得长于 160 字。
 * - 第 5 档（`explain`，唯一允许讲解的入口）允许陈述句，但仍然受长度约束，
 *   且仍不得命中泄露措辞。
 * - `null` 等级（仅 `stall_signal` / `review_work` 的兜底）按引导档处理。
 */
export function checkAnswerLeak(text: string, level: TutorHintLevel | null): AnswerLeakVerdict {
  const trimmed = text.trim();
  for (const marker of ANSWER_LEAK_MARKERS) {
    if (trimmed.includes(marker)) {
      return {
        ok: false,
        reason: `命中泄露措辞「${marker}」`,
        replacement: '这条回复本该由你一步步想出来，我先把它改成一个问题：你觉得哪一步最不确定？',
      };
    }
  }
  const limit = level === EXPLAIN_ONLY_LEVEL ? 320 : 160;
  if (trimmed.length > limit) {
    return {
      ok: false,
      reason: `长度 ${trimmed.length} 超过第 ${level ?? 1} 档上限 ${limit}`,
      replacement: '提示太长了，我把它收短一点：先说清你已经确定的那一部分，好吗？',
    };
  }
  if (level !== EXPLAIN_ONLY_LEVEL && !SOCRATIC_TAIL.test(trimmed)) {
    return {
      ok: false,
      reason: '引导档回复必须以问句收尾',
      replacement: `${trimmed.replace(/[。!！]\s*$/, '')}，你觉得呢？`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * 默认实现：确定性启发式导师
 * ------------------------------------------------------------------ */

const DEMO_EXPLANATION =
  '我来讲清方法本身：先把你的问题写成一句可检验的话，再找出支持它的一条证据，' +
  '最后用你自己的话复述一遍——复述得出来，才说明你真的懂了。';

/** 把一段文本切成 2–6 字的可见增量，让前端看到「正在写」。 */
export function splitIntoDeltas(text: string): string[] {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const step = 2 + (index % 5); // 2..6，确定性
    chunks.push(text.slice(index, index + step));
    index += step;
  }
  return chunks.length > 0 ? chunks : [text];
}

/** 引用学生自己的话，最多 12 字；这是学生自己的输入，不是他人数据。 */
function quoteOwnWords(input: TutorTurnInput): string {
  const source = (input.content ?? input.optionLabel ?? '').replace(/\s+/g, ' ').trim();
  if (source.length === 0) return input.currentTaskTitle;
  return source.length <= 12 ? source : `${source.slice(0, 12)}…`;
}

/**
 * 确定性启发式导师。
 *
 * 同样的输入必然产生同样的输出，便于 QA 复现；不依赖随机数、时间或网络。
 * 它执行四个**真实**工具步骤（读取项目上下文、查掌握度、选择提示等级、
 * 答案泄露校验），而不是装饰性的假动作。
 */
export class HeuristicTutorProvider implements TutorProvider {
  async *generateTurn(input: TutorTurnInput): AsyncGenerator<TutorStreamEvent, void, undefined> {
    const callIds = {
      context: `call-ctx-${input.sessionId}`,
      mastery: `call-mas-${input.sessionId}`,
      ladder: `call-lad-${input.sessionId}`,
      guard: `call-grd-${input.sessionId}`,
    };

    // 步骤 1 —— 读取项目上下文（真实读取，结果来自入参投影）。
    yield { type: 'tool_call', callId: callIds.context, name: 'project.context.read', label: '读取你的项目与当前阶段' };
    yield {
      type: 'tool_result',
      callId: callIds.context,
      status: 'done',
      result: `已读取项目「${input.projectTitle}」，当前阶段：${stageLabel(input.projectStage)}`,
    };

    // 步骤 2 —— 查掌握度（对会话历史做真实统计）。
    yield { type: 'tool_call', callId: callIds.mastery, name: 'mastery.progress.lookup', label: '查看你的掌握度记录' };
    yield {
      type: 'tool_result',
      callId: callIds.mastery,
      status: 'done',
      result:
        input.previousHintLevel === null
          ? `这是第 ${input.turnCount + 1} 轮，暂时还没有提示记录`
          : `已进行 ${input.turnCount} 轮，目前最高提示等级为第 ${input.previousHintLevel} 档`,
    };

    // 步骤 3 —— 选择提示等级（真实执行阶梯策略）。
    const level = selectHintLevel(input.pedagogicMove, input.previousHintLevel, input.turnCount);
    yield { type: 'tool_call', callId: callIds.ladder, name: 'pedagogy.hint_level.select', label: '选择下一步的提示阶梯' };
    yield {
      type: 'tool_result',
      callId: callIds.ladder,
      status: 'done',
      result:
        level === null
          ? '本轮不改变提示等级'
          : `本轮给出第 ${level} 档（每轮最多上升 1 档）`,
    };

    // 生成候选回复，再做答案泄露校验。
    const candidate = composeReply(input, level);
    const verdict = checkAnswerLeak(candidate.text, level);
    const finalText = verdict.ok ? candidate.text : (verdict.replacement ?? candidate.text);
    const finalBlock = verdict.ok ? candidate.block : { kind: 'hint' as const, level: level ?? HINT_LEVEL_MIN, text: finalText };

    for (const fragment of splitIntoDeltas(finalText)) {
      yield { type: 'delta', text: fragment };
    }

    // 步骤 4 —— 答案泄露校验（真实闸门；上面的最终文案就是它的产物）。
    yield { type: 'tool_call', callId: callIds.guard, name: 'safety.answer_leak.guard', label: '检查回复不泄露完整答案' };
    yield {
      type: 'tool_result',
      callId: callIds.guard,
      status: verdict.ok ? 'done' : 'error',
      result: verdict.ok
        ? `校验通过（第 ${level ?? HINT_LEVEL_MIN} 档，未包含完整答案）`
        : `已改写：${verdict.reason ?? '原始回复不合规'}`,
    };

    yield { type: 'block', block: finalBlock };
    yield {
      type: 'done',
      turnSummary: { hintLevel: level, stage: input.projectStage },
    };
  }
}

function composeReply(
  input: TutorTurnInput,
  level: TutorHintLevel | null,
): { text: string; block: TutorReplyBlock } {
  const quote = quoteOwnWords(input);

  if (input.pedagogicMove === 'scaffold') {
    const items = [
      `第一步：用一句话说清你要解决的问题——「${quote}」。`,
      `第二步：在${input.currentTaskTitle}里找出 1 条能支持你判断的证据。`,
      '第三步：用你自己的话把这条证据讲给同学听，讲不通的地方就是下一步要问的。',
    ];
    return { text: items.join('\n'), block: { kind: 'questions', items } };
  }

  if (input.pedagogicMove === 'review_work') {
    const text = '我先不给结论。你打算怎么验证方案的第一步？说说你会拿什么去比一比。';
    return { text, block: { kind: 'hint', level: level ?? HINT_LEVEL_MIN, text } };
  }

  if (input.pedagogicMove === 'stall_signal') {
    const text = '卡住也不是坏事。我们先分清：你是「想不出下一步」，还是「知道下一步但做不出来」？';
    return { text, block: { kind: 'questions', items: [text] } };
  }

  if (input.pedagogicMove === 'explain' || level === EXPLAIN_ONLY_LEVEL) {
    const text = DEMO_EXPLANATION;
    return { text, block: { kind: 'hint', level: EXPLAIN_ONLY_LEVEL, text } };
  }

  const text = composeSocraticText(level ?? HINT_LEVEL_MIN, quote, input);
  return { text, block: { kind: 'hint', level: level ?? HINT_LEVEL_MIN, text } };
}

function composeSocraticText(
  level: TutorHintLevel,
  quote: string,
  input: TutorTurnInput,
): string {
  switch (level) {
    case 1:
      return `先不急着找答案。你提到「${quote}」，你觉得这里最关键的一个词是哪个？`;
    case 2:
      return `给个方向：把「${quote}」分成「已经知道的」和「还不知道的」两栏，你先填其中一栏，好吗？`;
    default:
      return `一条线索：留意「${input.currentTaskTitle}」里说的条件，它和你现在的问题之间差了什么？`;
  }
}

const STAGE_LABELS: Record<ProjectStage, string> = {
  exploration: '自由探索',
  intent_confirmed: '已确认意图',
  theory_learning: '理论学习',
  theory_check: '理论检验',
  practice_ready: '实践就绪',
  practice_building: '动手制作',
  artifact_review: '作品评审',
  reflection: '反思',
  published: '已发布',
  completed: '已完成',
};

export function stageLabel(stage: ProjectStage): string {
  return STAGE_LABELS[stage] ?? stage;
}
