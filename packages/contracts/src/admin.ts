import type { ProjectStage } from './project.js';
import type { DataSource } from './platform.js';

/**
 * 平台管理后台契约。
 *
 * 首期必须有三个板块（用户明确要求）：
 *  1. **设置** —— 模型供应商 / 模型 / 用途绑定（复用 `models.ts`）
 *  2. **学生端数据查看**
 *  3. **教师端数据查看**
 *
 * ⚠️ **数据来源标注**：当前后端还没有持久层，所有统计都是服务端内存里的
 * **演示种子数据**。因此每个响应都带 `dataSource`，界面必须如实展示，
 * 不允许把种子数据画成真实运营数据。接入真实数据库后改为 `'live'` 即可。
 *
 * 本文件是 type-only，不含运行时逻辑。
 */

export type AdminDataSource = DataSource;

/** 管理后台一级板块（与 `(console)/layout.tsx` 的侧边导航对应）。 */
export type AdminSectionId = 'overview' | 'students' | 'teachers' | 'settings';

/* ------------------------------------------------------------------ *
 * 概览
 * ------------------------------------------------------------------ */

export interface AdminOverviewStats {
  studentCount: number;
  /** 处于 `completed` / `published` 之外、且已确认意图的项目。 */
  activeProjectCount: number;
  /** 服务端按停滞时长判定的卡顿学生数（不是风险标签）。 */
  stuckStudentCount: number;
  teacherCount: number;
  /** 班主任端待处理的介入请求数。 */
  pendingInterventionCount: number;
  /** 已发布作品数。 */
  publishedArtifactCount: number;
}

export interface AdminOverviewPageData {
  stats: AdminOverviewStats;
  /** 最近的介入请求，用于概览页快速一瞥。 */
  recentInterventions: AdminInterventionRow[];
  generatedAt: string;
  dataSource: AdminDataSource;
}

/* ------------------------------------------------------------------ *
 * 学生端数据
 * ------------------------------------------------------------------ */

export type AdminStudentFilter = 'all' | 'active' | 'stuck' | 'no_project';

export interface AdminStudentQuery {
  filter: AdminStudentFilter;
  /** 按班级 / 班主任筛选；null 表示不限。 */
  classLabel: string | null;
  mentorId: string | null;
  /** 按姓名或邮箱模糊搜索；null 表示不限。 */
  search: string | null;
  cursor: string | null;
  limit: number;
}

export interface AdminStudentRow {
  studentId: string;
  displayName: string;
  email: string;
  gradeLabel: string | null;
  classLabel: string | null;
  /** 当前班主任。一个学生同一时间只能有一个（AGENTS.md 硬约束）。 */
  mentorId: string | null;
  mentorName: string | null;
  activeProjectCount: number;
  projectsCompleted: number;
  currentProjectId: string | null;
  currentProjectTitle: string | null;
  currentStage: ProjectStage | null;
  progressPercent: number;
  lastActivityAt: string | null;
  /** 服务端判定的「停滞」，用于列表高亮；界面上必须写成「需要关注」。 */
  stuck: boolean;
  /** 该学生未处理的介入请求数。 */
  attentionCount: number;
}

export interface AdminStudentDetail {
  student: AdminStudentRow;
  /** 最近的成长记录（家长 / 班主任投影的措辞，不含原始对话）。 */
  recentGrowth: AdminGrowthDigest[];
  interventions: AdminInterventionRow[];
  projects: AdminStudentProject[];
  sessionsThisWeek: number;
  minutesThisWeek: number;
  dataSource: AdminDataSource;
}

export interface AdminStudentProject {
  projectId: string;
  title: string;
  stage: ProjectStage;
  progressPercent: number;
  updatedAt: string;
}

export interface AdminGrowthDigest {
  id: string;
  occurredAt: string;
  title: string;
  summary: string;
}

export interface AdminStudentListPageData {
  items: AdminStudentRow[];
  nextCursor: string | null;
  hasNext: boolean;
  /** 全量计数，供筛选标签展示（不受分页影响）。 */
  totals: {
    all: number;
    active: number;
    stuck: number;
    noProject: number;
  };
  /** 可选的筛选维度，由服务端给出，避免前端硬编码班级名。 */
  classOptions: string[];
  mentors: AdminMentorOption[];
  dataSource: AdminDataSource;
}

export interface AdminMentorOption {
  mentorId: string;
  displayName: string;
}

/* ------------------------------------------------------------------ *
 * 教师端数据
 * ------------------------------------------------------------------ */

export interface AdminTeacherQuery {
  search: string | null;
  cursor: string | null;
  limit: number;
}

export interface AdminTeacherRow {
  teacherId: string;
  displayName: string;
  email: string;
  /** 一个班主任可负责多个学生；学生端只会有一个当前班主任。 */
  studentCount: number;
  classLabels: string[];
  pendingInterventionCount: number;
  resolvedThisWeek: number;
  /** 负责学生中处于停滞状态的人数。 */
  stuckStudentCount: number;
  lastActivityAt: string | null;
}

export interface AdminTeacherDetail {
  teacher: AdminTeacherRow;
  students: AdminStudentRow[];
  interventions: AdminInterventionRow[];
  dataSource: AdminDataSource;
}

export interface AdminTeacherListPageData {
  items: AdminTeacherRow[];
  nextCursor: string | null;
  hasNext: boolean;
  totals: {
    all: number;
    withPendingIntervention: number;
    idle: number;
  };
  dataSource: AdminDataSource;
}

/* ------------------------------------------------------------------ *
 * 介入请求（学生端 / 教师端共用的一行）
 * ------------------------------------------------------------------ */

export type AdminInterventionStatus = 'open' | 'acknowledged' | 'resolved';

export interface AdminInterventionRow {
  id: string;
  studentId: string;
  studentDisplayName: string;
  projectTitle: string | null;
  reason: string;
  status: AdminInterventionStatus;
  createdAt: string;
  /** 已指派班主任；未指派时为 null。 */
  assigneeName: string | null;
}

/* ------------------------------------------------------------------ *
 * 设置
 *
 * 设置页是一个「索引」：只列出真实可用的面板，其余明确标为 `planned`。
 * 不允许为了填满界面而渲染假的设置项。
 * ------------------------------------------------------------------ */

export type AdminSettingsPanelId =
  | 'model_providers'
  | 'model_usages'
  | 'model_slots'
  | 'platform'
  | 'security'
  | 'audit';

export interface AdminSettingsPanel {
  id: AdminSettingsPanelId;
  title: string;
  description: string;
  /** 可点击进入的子路由（相对 basePath）；未开放时为 null。 */
  route: string | null;
  status: 'available' | 'planned';
}

export interface AdminSettingsIndexData {
  panels: AdminSettingsPanel[];
  /** 已配置的供应商数与已绑定的用途数，供设置页概览展示。 */
  configuredProviderCount: number;
  configuredUsageCount: number;
  dataSource: AdminDataSource;
}

/* ------------------------------------------------------------------ *
 * AI 运行时治理（只读控制面）
 *
 * 管理员可见的只读聚合视图，覆盖：
 *  1. skills（能力/技能注册）
 *  2. MCP 服务器注册
 *  3. 项目 Agent 角色与设置
 *  4. 内置工具注册
 *  5. 数据库 / 知识库 / 模板 / Tutor 的初始化状态
 *
 * 安全边界（AGENTS.md + ADR 0008 / 产品文档 7.0）：
 *  - registry 与初始化状态投影均已脱敏：服务端不得返回 API Key、MCP 凭据、
 *    完整系统提示词或未成年人原始对话。
 *  - 无法证实的信息一律返回 `'unknown'`，前端不得推断成 `ready`。
 *  - registry snapshot 与初始化 GET 为只读；初始化 POST 仅由服务端 admin
 *    授权并通过幂等边界执行受限 foundation 操作，客户端不能直接写状态。
 *  - 数据库 schema migration 永远不通过 HTTP 执行。
 * ------------------------------------------------------------------ */

/** 运行时整体健康度；`unknown` 表示证据不足，不得当作正常。 */
export type AdminRuntimeHealth = 'ready' | 'degraded' | 'not_ready' | 'unknown';

/** 单个运行时条目的状态；语义与 `enabled` 分开，避免把「已配置」误当成「可用」。 */
export type AdminRuntimeItemStatus =
  | 'enabled'
  | 'disabled'
  | 'ready'
  | 'unavailable'
  | 'error'
  | 'unknown';

/** 条目来源：内置 / 管理员配置 / 未知（旧数据或探测失败）。 */
export type AdminRuntimeSource = 'builtin' | 'configured' | 'runtime' | 'development' | 'unknown';

export interface AdminRuntimePolicy {
  id: string;
  version: string | null;
  contentHash: string | null;
  status: 'ready' | 'missing';
  content: string | null;
}

/* ---- skills ---- */

export interface AdminRuntimeSkill {
  id: string;
  label: string;
  description: string | null;
  version: string | null;
  source: AdminRuntimeSource;
  status: AdminRuntimeItemStatus;
  content: string;
  /** 声明使用该 skill 的 agent id；无来源时为空数组。 */
  agentIds: string[];
}

/* ---- MCP 服务器 ---- */

export type AdminMcpTransport = 'stdio' | 'sse' | 'streamable_http' | 'unknown';

export type AdminMcpConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'not_configured'
  | 'unknown';

export interface AdminRuntimeMcpServer {
  id: string;
  label: string;
  transport: AdminMcpTransport;
  status: AdminMcpConnectionStatus;
  enabled: boolean;
  /** 已发现工具数；未知时为 null，不得用 0 冒充「无工具」。 */
  toolCount: number | null;
  /**
   * 端点来源（scheme + host + port）。服务端必须剥掉路径、查询串与凭据；
   * 本地 stdio 传输为 null。
   */
  endpointOrigin: string | null;
  lastCheckedAt: string | null;
  /** 已脱敏的错误摘要；服务端保证不含凭据或原始响应体。 */
  lastError: string | null;
}

/* ---- 项目 Agent 角色与设置 ---- */

export interface AdminRuntimeAgent {
  id: string;
  label: string;
  description: string | null;
  /** 项目 Agent 角色名（如 tutor / planner）；无法确定时为 null。 */
  role: string | null;
  /** Admin-governed concise role definition used in each Tutor context. */
  roleDefinition: string;
  /** Agent-local agents.md definition; bounded and server-owned. */
  agentDefinition: string;
  parentAgentId: string | null;
  enabled: boolean;
  status: AdminRuntimeItemStatus;
  /** 绑定的模型用途 id（如 `tutor.chat`）；未绑定时为 null。 */
  modelUsage: string | null;
  promptVersion: string | null;
  /** 能力范围（如 explore / plan / teach / review / reflect）。 */
  capabilities: string[];
  /** Explicitly bound runtime skill ids. */
  skillIds: string[];
  /** Explicitly bound built-in tool ids. */
  toolIds: string[];
  /** Explicitly bound MCP server ids. */
  mcpServerIds: string[];
  /** Explicitly allowed MCP tool ids by server. */
  mcpToolIds: Record<string, string[]>;
}

export interface AdminRuntimeAgentUpdateRequest {
  label?: string;
  roleDefinition?: string;
  agentDefinition?: string;
  parentAgentId?: string | null;
  modelUsage?: string;
  capabilities?: string[];
  skillIds?: string[];
  skillBindings?: Array<{ skillId: string; inheritToChildren?: boolean }>;
  toolIds?: string[];
  mcpBindings?: Array<{ serverId: string; toolIds?: string[] }>;
  enabled?: boolean;
}



export type AdminRuntimeToolRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface AdminRuntimeBuiltinTool {
  id: string;
  label: string;
  description: string | null;
  status: AdminRuntimeItemStatus;
  /** 注册了该工具的 agent id。 */
  agentIds: string[];
  /** 是否受「实践前必须 TheoryMastered」门禁约束；未知时为 null。 */
  requiresTheoryMastered: boolean | null;
  riskLevel: AdminRuntimeToolRiskLevel;
}

/* ---- 初始化状态 ---- */

export type AdminInitializationCheckStatus =
  | 'ready'
  | 'missing'
  | 'failed'
  | 'not_applicable'
  | 'unknown';

/** 初始化检查所属领域。 */
export type AdminInitializationArea =
  | 'database'
  | 'knowledge'
  | 'template'
  | 'tutor'
  | 'registry'
  | 'other';

export interface AdminInitializationCheck {
  id: string;
  label: string;
  area: AdminInitializationArea;
  status: AdminInitializationCheckStatus;
  detail: string | null;
  checkedAt: string;
  /** 失败时可执行的人工修复建议；无建议时为 null。 */
  remediation: string | null;
  /** 最近一次成功初始化时间；无审计证据时为 null。 */
  lastRun?: string | null;
  /** true 表示必须由部署或 CLI 运维流程执行。 */
  operatorRequired?: boolean;
  /** 当前服务是否允许通过管理 API 执行。 */
  executeAllowed?: boolean;
}

export type AdminRuntimeDataMode = 'live' | 'demo' | 'test' | 'unknown';

export type AdminRuntimeDatabaseStatus =
  | 'connected'
  | 'in_memory'
  | 'unavailable'
  | 'unknown';

export interface AdminInitializationStatus {
  overall: AdminRuntimeHealth;
  dataMode: AdminRuntimeDataMode;
  database: AdminRuntimeDatabaseStatus;
  /** 已应用的迁移版本（如 `0013`）；无法确定时为 null。 */
  migrationVersion: string | null;
  checks: AdminInitializationCheck[];
}

/** Resolved model purposes available to an Agent role. */
export interface AdminRuntimeModelUsageOption {
  id: string;
  label: string;
  available: boolean;
  modelId: string | null;
}
export interface AdminRuntimeSnapshot {
  generatedAt: string;
  overall: AdminRuntimeHealth;
  dataSource: AdminDataSource;
  policy: AdminRuntimePolicy;
  skills: AdminRuntimeSkill[];
  mcpServers: AdminRuntimeMcpServer[];
  agents: AdminRuntimeAgent[];
  modelUsageOptions: AdminRuntimeModelUsageOption[];
  builtInTools: AdminRuntimeBuiltinTool[];
  initialization: AdminInitializationStatus;
}

