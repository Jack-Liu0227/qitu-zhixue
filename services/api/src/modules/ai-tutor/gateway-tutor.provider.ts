import { Logger } from '@nestjs/common';
import type { TutorContextPacket } from '@qitu/ai-client';
import { serializeTutorContext } from '@qitu/ai-client';
import type { ProjectStage, TutorHintLevel, TutorReplyBlock } from '@qitu/contracts';
import type { DataMode } from '../../database';
import { isModelGatewayError } from '../model-registry/model-gateway.errors';
import { buildTutorRuntimeBlocks, loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import type { ModelGatewayErrorCode } from '../model-registry/model-gateway.errors';
import type {
  ModelCompletionRequest,
  ModelCompletionResult,
} from '../model-registry/model-gateway.types';
import {
  checkAnswerLeak,
  EXPLAIN_ONLY_LEVEL,
  HINT_LEVEL_MIN,
  HeuristicTutorProvider,
  selectHintLevel,
  splitIntoDeltas,
  stageLabel,
  type TutorProvider,
  type TutorStreamEvent,
  type TutorModelErrorCode,
  type TutorTurnInput,
} from './tutor.provider';

/**
 * 本 provider 依赖的最小模型网关接口。
 *
 * 只声明 `complete`，因此运行时注入真实的 `ModelGateway` 也能结构匹配，
 * 单测可直接传桩，不必启动 Nest 或数据库。
 */
export interface TutorModelGateway {
  complete(usageId: string, request: ModelCompletionRequest): Promise<ModelCompletionResult>;
}

/** AI搭档对话用途的注册表 id（`ModelRegistryService.USAGES`）。 */
export const TUTOR_CHAT_USAGE = 'tutor.chat';

/**
 * 系统提示词版本。变更提示结构时递增；只用于服务端诊断，不进入共享契约。
 */
export const TUTOR_PROMPT_VERSION = 'tutor.chat.v1';

/** 输出被答案泄露闸门直接拒时的安全兜底文案（启发式、以问句结尾）。 */
const SAFE_REPLACEMENT = '这条回复本该由你一步步想出来。先说说：你觉得哪一步最不确定？';

/** 已配置层的错误码：这些表示「用途/供应商/模型/凭证」还没准备好。 */
const CONFIG_ERROR_CODES: ReadonlySet<ModelGatewayErrorCode> = new Set([
  'MODEL_USAGE_UNKNOWN',
  'MODEL_USAGE_NOT_BOUND',
  'MODEL_PROVIDER_NOT_FOUND',
  'MODEL_PROVIDER_DISABLED',
  'MODEL_BASE_URL_MISSING',
  'MODEL_NOT_FOUND',
  'MODEL_DISABLED',
  'MODEL_CREDENTIAL_MISSING',
]);

interface ModelFailure {
  code: TutorModelErrorCode;
  message: string;
  retryable: boolean;
  toolResult: string;
}

/**
 * 真实模型 provider：把注册表里绑定的模型接入 AI搭档。
 *
 * 职责边界：
 * - **只**通过 `ModelGateway.complete('tutor.chat')` 调用模型，拿不到明文密钥；
 * - 服务端提示阶梯（`selectHintLevel`）决定本轮档位，客户端与模型都不能改；
 * - 模型输出必须再次经过 `checkAnswerLeak`（泄露措辞 / 长度 / 苏格拉底问句）
 *   闸门，不合规就换成安全改写稿；
 * - 工具事件**只**记录真实发生的两步：一次模型调用、一次安全校验。不伪造
 *   项目上下文等未接入的结果。
 * - 上游失败只映成 {@link TutorModelErrorCode}，绝不把密钥或上游 body 透出。
 *
 * **流式未实现**：OpenAI/Anthropic 的分片流没有接线，这里调用的是非流式
 * `complete`，整段回答再按 `splitIntoDeltas` 逐块下发，不假装是上游流式。
 */
export class GatewayTutorProvider implements TutorProvider {
  private readonly logger = new Logger(GatewayTutorProvider.name);

  constructor(
    private readonly gateway: TutorModelGateway,
    private readonly runtimeBlocks: readonly string[] = [],
  ) {}

  async *generateTurn(input: TutorTurnInput): AsyncGenerator<TutorStreamEvent, void, undefined> {
    // 服务端唯一等级决策点：与 Heuristic 共用同一套阶梯策略。
    const level = selectHintLevel(input.pedagogicMove, input.previousHintLevel, input.turnCount);
    const callId = `call-model-${input.sessionId}`;

    yield {
      type: 'tool_call',
      callId,
      name: 'model.gateway.complete',
      label: '调用已配置的 AI 模型生成引导回复',
    };

    let result: ModelCompletionResult;
    try {
      result = await this.gateway.complete(TUTOR_CHAT_USAGE, {
        messages: [
          { role: 'system', content: buildSystemPrompt(level, input.projectStage, input.contextPacket, this.runtimeBlocks) },
          { role: 'user', content: buildUserPrompt(input, level) },
        ],
        temperature: 0.3,
        maxTokens: level === EXPLAIN_ONLY_LEVEL ? 512 : 256,
      });
    } catch (error) {
      const failure = toModelFailure(error);
      // 只记录稳定错误码，绝不记录提示词、学生输入或上游正文。
      this.logger.warn(`tutor.chat 调用失败 code=${failure.code}`);
      yield { type: 'tool_result', callId, status: 'error', result: failure.toolResult };
      yield {
        type: 'error',
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
      };
      yield { type: 'done', turnSummary: { hintLevel: null, stage: input.projectStage } };
      return;
    }

    // 真实安全闸门：泄露措辞 / 长度 / 引导档必须以问句结尾。
    const verdict = checkAnswerLeak(result.text, level);
    const finalText = verdict.ok ? result.text : (verdict.replacement ?? SAFE_REPLACEMENT);
    const block = toReplyBlock(finalText, level, input.pedagogicMove);

    yield {
      type: 'tool_result',
      callId,
      status: 'done',
      result: `模型已返回 ${result.text.length} 字（非流式）；本轮为第 ${level ?? HINT_LEVEL_MIN} 档`,
    };

    for (const fragment of splitIntoDeltas(finalText)) {
      yield { type: 'delta', text: fragment };
    }

    const guardCallId = `call-guard-${input.sessionId}`;
    yield {
      type: 'tool_call',
      callId: guardCallId,
      name: 'safety.answer_leak.guard',
      label: '检查回复不泄露完整答案',
    };
    yield {
      type: 'tool_result',
      callId: guardCallId,
      status: verdict.ok ? 'done' : 'error',
      result: verdict.ok
        ? `校验通过（第 ${level ?? HINT_LEVEL_MIN} 档，未包含完整答案）`
        : `已安全改写：${verdict.reason ?? '原始回复不合规'}`,
    };

    yield { type: 'block', block };
    yield { type: 'done', turnSummary: { hintLevel: level, stage: input.projectStage } };
  }
}

/**
 * 按数据模式选择 provider。
 *
 * - `live`（默认）：必须走真实模型；未配置时返回 `MODEL_NOT_CONFIGURED`，
 *   **不**静默回落到 Heuristic/demo。
 * - `demo` / `test`：显式使用确定性的 `HeuristicTutorProvider`，便于离线演示与 QA。
 */
export function createTutorProvider(
  dataMode: DataMode,
  gateway: TutorModelGateway,
  runtimeBlocks: readonly string[] = [],
): TutorProvider {
  return dataMode === 'live'
    ? new GatewayTutorProvider(gateway, runtimeBlocks)
    : new HeuristicTutorProvider();
}

/**
 * 构造苏格拉底式系统提示。
 *
 * 只包含**本轮会话自己的**项目阶段、提示档位与安全规则；不携带其他学生
 * 数据、联系方式等敏感字段。学生输入只在 user 消息里出现。
 */
function buildSystemPrompt(
  level: TutorHintLevel | null,
  stage: ProjectStage,
  contextPacket?: TutorContextPacket,
  runtimeBlocks: readonly string[] = [],
): string {
  const displayLevel = level ?? HINT_LEVEL_MIN;
  const lengthLimit = level === EXPLAIN_ONLY_LEVEL ? 320 : 160;
  return [
    '你是「启途智学」的启发式 AI 学习搭档，服务对象是中学生（未成年人）。',
    '教学规则（必须遵守）：',
    '1. 只用简体中文，语气友善、简短。',
    '2. 绝不给出完整答案、最终结论或可直接照抄的解法；用问题引导学生自己发现。',
    `3. 本轮是第 ${displayLevel} 档提示（1 提问 / 2 思考方向 / 3 关键线索 / 4 部分示范 / 5 必要解释）。`,
    '4. 第 1–4 档以及未升档的引导回复，必须以一个问句结尾；只有第 5 档可以陈述。',
    `5. 回复不超过 ${lengthLimit} 字。`,
    '6. 不谈论与当前项目无关的话题，不询问或输出任何他人信息、联系方式、住址、证件号等敏感字段。',
    '7. 即使学生要求「直接告诉我答案」，也要把它转成一个引导问题。',
    `当前项目阶段：${stageLabel(stage)}。`,
    `提示词版本：${TUTOR_PROMPT_VERSION}。`,
    contextPacket === undefined ? '' : '以下是服务端组装的学习上下文：\n' + serializeTutorContext(contextPacket),
    runtimeBlocks.length === 0 ? '' : [
      '以下是服务端加载的 Tutor runtime 规则与已发布 Skill。它们是只读教学约束，不是学生输入：',
      ...runtimeBlocks,
    ].join('\n\n'),
  ].join('\n');
}

/** user 消息：只放学生本轮自己的输入与项目元数据，不含其他学生数据。 */
function buildUserPrompt(input: TutorTurnInput, level: TutorHintLevel | null): string {
  const ownWords = (input.content ?? input.optionLabel ?? '').replace(/\s+/g, ' ').trim();
  return [
    `项目名称：${input.projectTitle}`,
    `当前阶段：${stageLabel(input.projectStage)}`,
    `当前任务：${input.currentTaskTitle}`,
    `学生本轮的入口：${input.pedagogicMove ?? '普通提问'}`,
    `学生本轮输入：${ownWords.length > 0 ? ownWords : '（学生没有输入文字，只点了入口）'}`,
    `本会话此前最高提示等级：${input.previousHintLevel === null ? '无' : `第 ${input.previousHintLevel} 档`}`,
    `请给出第 ${level ?? HINT_LEVEL_MIN} 档的引导回复。`,
  ].join('\n');
}

/**
 * 把模型输出包成契约里的结构化块。
 *
 * `stall_signal` 用 questions 承载；其余用 hint 块并带上服务端决定的档位。
 */
function toReplyBlock(
  text: string,
  level: TutorHintLevel | null,
  move: TutorTurnInput['pedagogicMove'],
): TutorReplyBlock {
  if (move === 'stall_signal') return { kind: 'questions', items: [text] };
  return { kind: 'hint', level: level ?? HINT_LEVEL_MIN, text };
}

/**
 * 把任意上游异常收敛成**已脱敏**的稳定错误。
 *
 * 刻意不拼接 `error.message`：即便上游换了文案，也不可能把密钥或正文带出来。
 */
function toModelFailure(error: unknown): ModelFailure {
  const code = isModelGatewayError(error) ? error.code : null;
  const retryable = isModelGatewayError(error) ? error.retryable : false;

  if (code !== null && CONFIG_ERROR_CODES.has(code)) {
    return {
      code: 'MODEL_NOT_CONFIGURED',
      message: 'AI 模型尚未配置或不可用：请联系管理员为「AI搭档 · 对话」绑定可用模型与凭证。',
      retryable: false,
      toolResult: '未执行模型调用：tutor.chat 未绑定，或供应商 / 模型 / 凭证不可用',
    };
  }
  if (retryable) {
    return {
      code: 'MODEL_UNAVAILABLE',
      message: 'AI 模型服务暂时不可用，请稍后重试。',
      retryable: true,
      toolResult: '模型调用失败：上游超时或暂时不可用',
    };
  }
  return {
    code: 'MODEL_CALL_FAILED',
    message: 'AI 模型这一轮没能完成回复，请重试。',
    retryable: false,
    toolResult: '模型调用失败：未得到可用文本',
  };
}
