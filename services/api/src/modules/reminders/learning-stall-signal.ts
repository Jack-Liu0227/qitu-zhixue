import type { ReminderTriggerSource } from '@qitu/contracts';

/**
 * 学习进度停滞信号的**唯一**来源常量。
 *
 * 这是本模块允许的唯一触发源：AI 搭档在会话里已经存在的「连续卡顿」计数
 * 越过升级阈值。它不是情绪识别、不是诊断、不是风险推断，只是一个
 * 「同一个问题上停留了 N 轮」的进度事实。
 */
export const LEARNING_PROGRESS_STALL_SOURCE: ReminderTriggerSource = 'learning_progress_stall';

/**
 * 连续卡顿达到该轮数才认为「进度停滞」，与 AI 搭档既有的升级阈值保持一致。
 *
 * 低于该值一律忽略，避免把正常思考误判成停滞。
 */
export const LEARNING_STALL_ESCALATION_THRESHOLD = 4;

/** 服务端内部的学习进度停滞信号。 */
export interface LearningStallSignal {
  /** 学生 id（由服务端会话记录给出，绝不来自请求体）。 */
  studentId: string;
  /** 会话内连续卡顿轮数。 */
  stallCount: number;
  /** 触发源；只允许 `LEARNING_PROGRESS_STALL_SOURCE`。 */
  source: ReminderTriggerSource;
}

/**
 * 学习进度停滞信号的接收端（provider seam）。
 *
 * `AiTutorModule` 只依赖这个抽象，不依赖 `RemindersModule` 的具体实现，
 * 因此 AI 搭档与提醒模块之间没有硬耦合；未接线或评审未通过时注入缺省安全实现。
 */
export abstract class LearningStallSignalSink {
  /**
   * 记录一次停滞信号。
   *
   * 约定：**必须同步、必须 fail-closed**。触发源不在白名单、轮数不足、
   * 评审门禁未通过或学生已 opt-out 时静默忽略——绝不抛错中断 AI 搭档回合，
   * 也绝不试探性地投递提醒。
   */
  abstract ingestStallSignal(signal: LearningStallSignal): void;
}

/**
 * 缺省（无操作）接收端。
 *
 * 当提醒能力不可用、评审未通过，或调用方未接入提醒模块时使用。显式存在，
 * 而不是让 AI 搭档在缺少 provider 时崩溃。
 */
export class NoopLearningStallSignalSink extends LearningStallSignalSink {
  ingestStallSignal(): void {
    // 有意为空：默认不产生任何提醒（fail-closed）。
  }
}
