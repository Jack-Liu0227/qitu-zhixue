import { ApiError } from '@qitu/api-client';
import type {
  ParentFeedbackSource,
  SubmitParentFeedbackRequest,
  SubmitParentFeedbackResponse,
} from '@qitu/contracts';
import { ParentOfflineError, ParentPermissionError, parentApi } from '../parentApi';
import type { FeedbackDraft, FeedbackFailureKind, FeedbackType, FeedbackTypeOption } from './types';

/**
 * 家长反馈的共享服务层。
 *
 * 设计要点：
 *  - 右下角浮窗、消息页、首页三处**只走这一个入口**，服务端只有一条工单链路；
 *  - 幂等键由调用方传入（通常取自草稿），网络失败重试时复用，避免重复工单；
 *  - `childId` 会按契约提交，但**后端当前演示实现尚未消费该字段**
 *    （`parent.controller.ts` 里仍硬编码为 `student-demo`）。前端提交它是为了让
 *    「有效孩子」这一必填选择进入契约，待后端接入后即可生效；服务端必须
 *    再次校验家长与孩子的绑定关系，前端选择不作为权限依据。
 */

export const FEEDBACK_CONTENT_MIN = 1;
export const FEEDBACK_CONTENT_MAX = 500;

/** 界面「反馈类型」下拉的选项，同时声明各自映射到的服务端 `source`。 */
export const FEEDBACK_TYPES: readonly FeedbackTypeOption[] = [
  {
    value: 'teacher',
    label: '联系班主任',
    description: '希望班主任了解或跟进孩子的情况',
    source: 'general',
  },
  {
    value: 'project',
    label: '学习项目相关',
    description: '针对某个具体项目的问题或建议',
    source: 'project',
  },
  {
    value: 'suggestion',
    label: '意见与建议',
    description: '对平台或服务的改进建议',
    source: 'general',
  },
];

/** `project` 类型需要关联项目（服务端对 `source=project` 强制要求 `projectId`）。 */
export function feedbackSourceFor(type: FeedbackType): ParentFeedbackSource {
  return type === 'project' ? 'project' : 'general';
}

export function feedbackTypeLabel(type: FeedbackType): string {
  return FEEDBACK_TYPES.find((option) => option.value === type)?.label ?? type;
}

/** 已分类的反馈提交错误。`kind` 驱动界面提示与「是否保留草稿」。 */
export class FeedbackSubmitError extends Error {
  constructor(
    message: string,
    readonly kind: FeedbackFailureKind,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'FeedbackSubmitError';
  }
}

export interface SubmitFeedbackInput {
  source: ParentFeedbackSource;
  content: string;
  childId?: string | null;
  messageId?: string | null;
  projectId?: string | null;
  /** 不传时由 `parentApi.post` 生成一个一次性幂等键。 */
  idempotencyKey?: string;
}

function classifySubmitError(error: unknown): FeedbackSubmitError {
  if (error instanceof FeedbackSubmitError) return error;
  if (error instanceof ParentPermissionError) {
    return new FeedbackSubmitError('当前账号没有提交反馈的权限。', 'permission');
  }
  if (error instanceof ParentOfflineError || error instanceof TypeError) {
    return new FeedbackSubmitError('网络不可用，反馈尚未提交。', 'offline');
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return new FeedbackSubmitError('当前账号没有提交反馈的权限。', 'permission', error.code);
    }
    if (error.status === 0) {
      return new FeedbackSubmitError('网络不可用，反馈尚未提交。', 'offline', error.code);
    }
    if (error.status === 400 || error.status === 409 || error.status === 422) {
      return new FeedbackSubmitError(
        error.message || '反馈内容未通过校验，请检查后重试。',
        'validation',
        error.code,
      );
    }
    return new FeedbackSubmitError(
      error.message || '反馈没能提交，请稍后重试。',
      'error',
      error.code,
    );
  }
  return new FeedbackSubmitError('反馈没能提交，请稍后重试。', 'error');
}

/**
 * 提交一条家长反馈，返回服务端工单信息。
 *
 * 所有失败都会抛出 `FeedbackSubmitError`，调用方据此决定提示文案与
 * 是否保留草稿（`offline` / `error` 一律保留）。
 */
export async function submitParentFeedback(
  input: SubmitFeedbackInput,
): Promise<SubmitParentFeedbackResponse> {
  const content = input.content.trim();
  if (content.length < FEEDBACK_CONTENT_MIN || content.length > FEEDBACK_CONTENT_MAX) {
    throw new FeedbackSubmitError(
      `反馈内容长度需在 ${FEEDBACK_CONTENT_MIN} 到 ${FEEDBACK_CONTENT_MAX} 字之间。`,
      'validation',
    );
  }
  if (input.source === 'project' && !input.projectId) {
    throw new FeedbackSubmitError('项目相关反馈需要先选择关联项目。', 'validation');
  }
  if (input.source === 'message' && !input.messageId) {
    throw new FeedbackSubmitError('消息相关反馈缺少关联消息。', 'validation');
  }

  const body: SubmitParentFeedbackRequest = {
    source: input.source,
    content,
    messageId: input.messageId ?? null,
    projectId: input.projectId ?? null,
    childId: input.childId ?? null,
  };

  try {
    const response = await parentApi.post<{ data: SubmitParentFeedbackResponse }>(
      '/api/v1/parent/feedback',
      body,
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    );
    return response.data;
  } catch (error) {
    throw classifySubmitError(error);
  }
}

/* ------------------------------------------------------------------ *
 * 草稿暂存（sessionStorage）
 *
 * 只存反馈所需的字段，不含任何 token／个人信息；用 sessionStorage 保证
 * 关闭标签页即失效，避免未成年人相关内容长期驻留在共享设备上。
 * ------------------------------------------------------------------ */

const DRAFT_KEY_PREFIX = 'qitu.parent.feedback.draft.v1:';

function draftStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    // 无痕模式等场景拿不到 storage：降级为不暂存，功能仍可用。
    return null;
  }
}

function draftKey(parentId: string): string {
  return `${DRAFT_KEY_PREFIX}${parentId}`;
}

function isFeedbackType(value: unknown): value is FeedbackType {
  return FEEDBACK_TYPES.some((option) => option.value === value);
}

export function createFeedbackIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyFeedbackDraft(childId = ''): FeedbackDraft {
  return {
    type: 'teacher',
    content: '',
    childId,
    projectId: null,
    idempotencyKey: createFeedbackIdempotencyKey(),
  };
}

/** 读取并校验本机草稿；结构不合法时丢弃，避免脏数据把界面打崩。 */
export function readFeedbackDraft(parentId: string): FeedbackDraft | null {
  const storage = draftStorage();
  if (!storage || !parentId) return null;
  const raw = storage.getItem(draftKey(parentId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FeedbackDraft>;
    if (
      !isFeedbackType(parsed.type) ||
      typeof parsed.content !== 'string' ||
      typeof parsed.childId !== 'string' ||
      (parsed.projectId !== null && typeof parsed.projectId !== 'string') ||
      typeof parsed.idempotencyKey !== 'string' ||
      parsed.idempotencyKey.length === 0
    ) {
      storage.removeItem(draftKey(parentId));
      return null;
    }
    return {
      type: parsed.type,
      content: parsed.content,
      childId: parsed.childId,
      projectId: parsed.projectId,
      idempotencyKey: parsed.idempotencyKey,
    };
  } catch {
    storage.removeItem(draftKey(parentId));
    return null;
  }
}

export function saveFeedbackDraft(parentId: string, draft: FeedbackDraft): void {
  const storage = draftStorage();
  if (!storage || !parentId) return;
  try {
    storage.setItem(draftKey(parentId), JSON.stringify(draft));
  } catch {
    // 存储写满／被禁用时静默降级，不影响提交。
  }
}

export function clearFeedbackDraft(parentId: string): void {
  const storage = draftStorage();
  if (!storage || !parentId) return;
  storage.removeItem(draftKey(parentId));
}

/**
 * 清空本机全部反馈草稿。
 *
 * 由「退出登录」触发：此时继续保留未成年人相关的内容已无必要，
 * 也避免下一个使用同一浏览器的账号读到上一个账号的草稿。
 */
export function clearAllFeedbackDrafts(): void {
  const storage = draftStorage();
  if (!storage) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}
