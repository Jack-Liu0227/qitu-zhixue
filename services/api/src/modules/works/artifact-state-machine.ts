/**
 * 作品（Artifact）服务端状态机 —— 纯函数，无 Nest / 数据库依赖。
 *
 * 产品硬规则（学生前后端设计 §5.4.7 / 4.6）：
 * - 发布必须经过 `draft → submitted → published`（服务端维护 `reviewing` 中间态）；
 * - 撤回可逆但不删历史；
 * - 客户端永远不能直接写 `status` / `publishedAt`。
 *
 * 状态取值与 `packages/database/src/schema/works.ts` 的注释保持一致：
 * `'draft' | 'submitted' | 'in_review' | 'published' | 'changes_requested' | 'archived'`。
 * 本模块只做判定，真正的写入由 `WorksStore` 在事务里完成。
 */

export const ARTIFACT_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'published',
  'changes_requested',
  'archived',
] as const;

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

/** 稳定错误码，控制器把它翻译成 HTTP 409。 */
export type ArtifactTransitionErrorCode =
  | 'ARTIFACT_TRANSITION_INVALID'
  | 'ARTIFACT_NOT_EDITABLE';

export class ArtifactTransitionError extends Error {
  constructor(
    readonly code: ArtifactTransitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactTransitionError';
  }
}

export function isArtifactStatus(value: unknown): value is ArtifactStatus {
  return typeof value === 'string' && (ARTIFACT_STATUSES as readonly string[]).includes(value);
}

/** 只有草稿 / 要求修改的版本可以被学生编辑；已提交 / 已发布进入只读。 */
export function isArtifactEditable(status: ArtifactStatus): boolean {
  return status === 'draft' || status === 'changes_requested';
}

export function assertArtifactEditable(status: ArtifactStatus): void {
  if (!isArtifactEditable(status)) {
    throw new ArtifactTransitionError(
      'ARTIFACT_NOT_EDITABLE',
      `作品状态为 ${status}，提交审核或发布后不可再编辑`,
    );
  }
}

/**
 * 学生申请发布：`draft | changes_requested | archived` → `submitted`。
 *
 * 若已有班主任批准（见 `WorksService`），则跳过 `submitted` 直接发布；
 * 这里只负责「无批准时先进入待审核」这一条路径。
 */
export function submitForReview(status: ArtifactStatus): ArtifactStatus {
  if (status === 'submitted' || status === 'in_review') return status;
  if (status === 'published') {
    throw new ArtifactTransitionError('ARTIFACT_TRANSITION_INVALID', '作品已发布，无需再次提交');
  }
  if (status === 'draft' || status === 'changes_requested' || status === 'archived') {
    return 'submitted';
  }
  throw new ArtifactTransitionError('ARTIFACT_TRANSITION_INVALID', `无法从 ${status} 提交审核`);
}

/** 有班主任批准时：`submitted | in_review | draft | changes_requested` → `published`。 */
export function publishFromReview(status: ArtifactStatus): ArtifactStatus {
  if (status === 'published') return status;
  if (
    status === 'submitted' ||
    status === 'in_review' ||
    status === 'draft' ||
    status === 'changes_requested'
  ) {
    return 'published';
  }
  throw new ArtifactTransitionError(
    'ARTIFACT_TRANSITION_INVALID',
    `作品状态为 ${status}，无法发布`,
  );
}

/**
 * 撤回：任意非终态都可进入 `archived`，且 `archived` 可再次发布（可逆）。
 * 已发布作品撤回后保留 `published_at` 作为历史事实，不删除版本。
 */
export function withdrawArtifact(status: ArtifactStatus): ArtifactStatus {
  if (status === 'archived') return status;
  return 'archived';
}
