/**
 * 模板版本 ↔ 团队版本绑定契约（api-spec F2 / F3）。
 *
 * 绑定是**服务端拥有的不可变引用**：模板版本指向某个 `admin_team_versions`
 * 快照，而不是可变的 `admin_teams` 行。项目创建时把当时生效的绑定冻结成
 * `ProjectBindingSnapshot`；此后退役 / 重新激活绑定都不会改写既有项目。
 *
 * 状态机（服务端唯一写入方，客户端只读）：
 *
 *   draft → validated → active → retired（terminal）
 *
 * 不变量：**一个模板版本同一时刻最多一个 `active` 绑定**。
 * 数据库以局部唯一索引兜底：
 *
 *   CREATE UNIQUE INDEX pbl_template_team_bindings_one_active_per_template_idx
 *     ON pbl_template_team_bindings (template_version_id)
 *     WHERE status = 'active';
 *
 * 并发双激活由该索引拒绝，服务端映射为 `BINDING_CONFLICT`(409)；激活事务
 * 先退役旧的 active 行再置新的 active，客户端不得直接写 `status`。
 */

/** 绑定生命周期状态。服务端状态机，客户端不可写。 */
export type PblBindingStatus = 'draft' | 'validated' | 'active' | 'retired';
export type TeachingPurpose = 'outline' | 'session' | 'dialogue';

/** Canonical references an Admin may edit before the server resolves artifacts. */
export interface TeachingBundleDraft {
  /** Explicit route required when the frozen template has no assigned assistant for a phase. */
  sessionRoutes?: readonly { sessionIndex: number; roleSlotId: string }[];
  templateVersionId: string;
  teamVersionId: string;
  scheduleProfileId: string;
  roleMap: readonly { roleSlotId: string; memberId: string; purposes: readonly TeachingPurpose[] }[];
  skillPins: readonly { roleSlotId: string; canonicalId: string; version: string; packageDigest: string }[];
  toolIds: readonly { roleSlotId: string; toolId: string }[];
  mcpServerIds: readonly string[];
  knowledgeBaseIds: readonly string[];
  modelByPurpose: Readonly<Record<string, Readonly<Partial<Record<TeachingPurpose, { modelProviderId: string; modelId: string }>>>>>;
  approvalPolicyVersion: string;
}

/**
 * 绑定状态迁移表（声明式，供服务端状态机与漂移测试共用）。
 * `retired` 是终态，没有出边。
 */
export const PBL_BINDING_STATUS_TRANSITIONS: Readonly<
  Record<PblBindingStatus, readonly PblBindingStatus[]>
> = {
  draft: ['validated'],
  validated: ['active'],
  active: ['retired'],
  retired: [],
};

/**
 * 服务端计算的绑定校验结果。
 *
 * `checkedAt` 为 null 表示尚未跑过校验（`draft` 的初始态）。
 * `errors` / `warnings` 是稳定的人类可读代码串，不含团队指令正文。
 */
export interface PblTemplateTeamBindingValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checkedAt: string | null;
}

/**
 * 模板版本与团队版本的绑定视图。
 *
 * `bindingHash` = `sha256(canonicalJson({ templateVersionId, teamVersionId, pblSpecHash }))`，
 * 用于审计与快照比对；客户端不得提交该字段。
 */
export interface PblTemplateTeamBinding {
  id: string;
  /** `project_template_versions.id`。 */
  templateVersionId: string;
  /** `admin_team_versions.id`（不可变团队快照）。 */
  teamVersionId: string;
  status: PblBindingStatus;
  bindingHash: string;
  /** Digest of the immutable teaching bundle compiled for this binding. */
  bundleDigest: string | null;
  bundleDraft?: TeachingBundleDraft | null;
  validation: PblTemplateTeamBindingValidation;
  activatedAt: string | null;
  retiredAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 项目创建时冻结的绑定快照（持久化行，只读）。
 *
 * 完整的正式快照不可覆盖。历史回填或缺教学摘要的旧快照只允许管理员经明确、
 * 同版本的修复命令重新确认，旧引用与修复原因保留审计；运行时读取不写入。
 * 之后激活 / 退役绑定只影响新项目，不改写既有快照——这是「冻结版本」保证。
 *
 * `backfilled === true` 表示该行是为历史项目惰性回填的派生快照，而非创建时冻结。
 */
export interface ProjectBindingSnapshot {
  projectId: string;
  templateVersionId: string;
  bindingId: string;
  teamVersionId: string;
  bindingHash: string;
  /** Teaching bundle digest frozen together with the binding. */
  bundleDigest: string | null;
  /** Immutable, binding-scoped IMA grant copied at project confirmation. */
  imaGrant?: {
    serverId: 'ima-knowledge';
    knowledgeBaseIds: readonly string[];
    allowedTools: readonly string[];
  } | null;
  boundAt: string;
  backfilled: boolean;
}

/**
 * 创建绑定请求体。
 *
 * 冻结 DTO 规则（对齐 `team-runtime.ts` 的 Admin 写入 DTO）：
 * 不含 `id` / `status` / `bindingHash` / `validation` / `activatedAt` /
 * `retiredAt` —— 全部服务端派生。幂等键只走 HTTP 头 `Idempotency-Key`，
 * **不放进 body**。
 */
export interface AdminBindingCreateInput {
  teamVersionId: string;
}

/** 校验请求体：校验结果由服务端计算，F2 没有客户端可写字段（空 body）。 */
export interface AdminBindingValidateInput {
  // 空：不发明客户端可写字段。
}

/** 激活请求体：状态迁移由服务端执行，F2 没有客户端可写字段（空 body）。 */
export interface AdminBindingActivateInput {
  // 空：不发明客户端可写字段。
}

/** 退役请求体。`reason` 只记录为审计元数据。 */
export interface AdminBindingRetireInput {
  reason?: string;
}

/** B5 预览里受影响的存量项目（仅 id 与标题，绝不含学生原文）。 */
export interface AdminBindingAffectedProject {
  projectId: string;
  studentUserId: string;
  title: string;
  planId: string | null;
}

/**
 * B5 预览响应 `{ data: ... }`。
 *
 * `activeBinding` 为 null 表示该模板版本当前没有生效绑定。
 */
export interface AdminBindingPreview {
  templateVersionId: string;
  affectedProjects: AdminBindingAffectedProject[];
  activeBinding: PblTemplateTeamBinding | null;
}

export interface AdminProjectBindingRecovery {
  projectId: string;
  state: 'ready' | 'missing' | 'legacy' | 'invalid';
}

export interface AdminProjectBindingReconfirmation {
  projectId: string;
  snapshot: ProjectBindingSnapshot;
  replayed: boolean;
}

/**
 * 绑定治理写动作（create / validate / activate / retire）的统一响应体。
 *
 * 四个写动作的响应形状完全相同：`data.binding` 是迁移后的绑定视图，
 * `data.replayed === true` 表示命中幂等缓存复用既有行（未产生新写）。
 * 控制器直接以本类型标注返回，避免与 `AdminBindingPreview`（内层契约）
 * 各自发明 `{ data: ... }` 外壳。
 */
export interface AdminBindingMutationResponse {
  data: {
    binding: PblTemplateTeamBinding;
    replayed: boolean;
  };
}

/**
 * 绑定治理动作的幂等作用域前缀（服务端 `IdempotencyStore.execute` 使用）。
 * 作用域必须再拼上资源 id，例如
 * `` `${ADMIN_TEMPLATE_BINDING_IDEMPOTENCY_SCOPES.activate}:${bindingId}` ``。
 */
export const ADMIN_TEMPLATE_BINDING_IDEMPOTENCY_SCOPES = {
  create: 'admin.template-binding.create',
  validate: 'admin.template-binding.validate',
  activate: 'admin.template-binding.activate',
  retire: 'admin.template-binding.retire',
} as const;
