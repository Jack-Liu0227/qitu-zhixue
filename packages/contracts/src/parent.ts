import type { StudentGrowthEntryType } from './growth';
import type { ProjectStage } from './project';
import type { DataSource } from './platform';

/**
 * 家长陪伴中心契约 —— 对照已批准的参考稿 `UI图片/家长仪表盘/` 三个页面：
 * `首页.png` / `学习进展.png` / `消息与反馈.png`。
 *
 * 三条不可越过的约束（继承自 growth-spec 与 AGENTS.md）：
 *  1. **没有分数、排名、百分位、等级**。所有指标都是过程性的。
 *  2. **没有原始 AI 对话、没有原始语音、没有内部风险标签**。
 *     给家长看的措辞一律是服务端预审过的。
 *  3. 家长只能读自己绑定的孩子；对象级权限由**后端**校验，前端隐藏不算数。
 *
 * 这些类型是 type-only，不含运行时逻辑。
 */

/** 家长端三个一级页面（与参考稿侧边导航一致）。 */
export type ParentPageId = 'home' | 'progress' | 'messages';

/* ------------------------------------------------------------------ *
 * 首页
 * ------------------------------------------------------------------ */

/** 首页顶部四张 KPI 卡。`value` 由服务端格式化，避免前端各自决定单位与小数位。 */
export type ParentKpiId =
  | 'weekly_sessions'
  | 'weekly_minutes'
  | 'current_progress'
  | 'streak';

export interface ParentKpi {
  id: ParentKpiId;
  label: string;
  /** 已格式化好的展示值，例如「4 次」「3 小时 20 分」「40%」「6 天」。 */
  value: string;
  /** 变化说明，例如「比上周多 1 次」。没有可比数据时为 null。 */
  hint: string | null;
  trend: 'up' | 'flat' | 'down';
}

/** 首页「当前学习项目」卡片。 */
export interface ParentCurrentProject {
  projectId: string;
  title: string;
  summary: string;
  /** 冻结状态机的阶段。 */
  stage: ProjectStage;
  /** 冻结模板里的阶段名（与 `stage` 分开：模板可换，阶段枚举不可换）。 */
  stageLabel: string;
  /** 仅用于进度条展示；**不得**用于任何门禁判定。 */
  progressPercent: number;
  todayTask: string | null;
  lastCompleted: string | null;
  nextStep: string | null;
}

/** 「需要您关注」的严重程度，决定配色；不是内部风险标签本身。 */
export type ParentAttentionLevel = 'ok' | 'info' | 'attention';

export interface ParentAttentionItem {
  id: string;
  level: ParentAttentionLevel;
  title: string;
  detail: string;
}

/** 服务端预审过的、给家长的一句可选择提问。 */
export interface ParentSuggestedQuestion {
  text: string;
  projectTitle: string | null;
}

/** 首页「本周成长摘要」三栏。 */
export interface ParentWeeklySummary {
  completed: string[];
  praised: string[];
  growing: string[];
}

/** 首页「最近成果」缩略项。 */
export interface ParentRecentArtifact {
  artifactRef: string;
  title: string;
  createdAt: string;
}

/** 一次渲染 `/parent` 首页所需的全部数据。 */
export interface ParentHomePageData {
  childId: string;
  childDisplayName: string;
  kpis: ParentKpi[];
  currentProject: ParentCurrentProject | null;
  attention: ParentAttentionItem[];
  suggestedQuestion: ParentSuggestedQuestion | null;
  weeklySummary: ParentWeeklySummary;
  recentArtifacts: ParentRecentArtifact[];
  /** 是否至少有一个项目；为 false 时展示空状态而不是空卡片。 */
  hasAnyProject: boolean;
  /** 数据来源；界面的「演示数据」标记由它驱动。 */
  dataSource: DataSource;
}

/* ------------------------------------------------------------------ *
 * 学习进展
 * ------------------------------------------------------------------ */

export type ParentWorkStatus = 'draft' | 'in_progress' | 'completed';

export interface ParentWorkItem {
  artifactRef: string;
  title: string;
  summary: string;
  status: ParentWorkStatus;
  /** 例如「V2 对话原型」；没有版本时为 null。 */
  versionLabel: string | null;
  progressPercent: number;
  tags: string[];
  updatedAt: string;
}

/** 「作品背后的成长」三栏：哪些是孩子独立完成的、哪些有 AI 协助、下一步。 */
export interface ParentWorkGrowth {
  independently: string[];
  withAiHelp: string[];
  nextPlan: string[];
}

/** 「版本成长」时间轴的一步。 */
export interface ParentVersionStep {
  id: string;
  at: string;
  title: string;
  note: string;
}

export interface ParentProgressPageData {
  childId: string;
  works: ParentWorkItem[];
  /** 参考稿展示的主作品；没有进行中的作品时为 null。 */
  focusWork: ParentWorkItem | null;
  focusGrowth: ParentWorkGrowth | null;
  focusVersions: ParentVersionStep[];
  dataSource: DataSource;
}

/* ------------------------------------------------------------------ *
 * 消息与反馈
 * ------------------------------------------------------------------ */

export type ParentMessageKind =
  | 'stage_update'
  | 'attention'
  | 'feedback_processing'
  | 'resolved'
  | 'artifact';

export type ParentMessageStatus =
  | 'unread'
  | 'pending_confirm'
  | 'processing'
  | 'resolved';

export interface ParentMessageTimelineStep {
  label: string;
  /** 尚未发生的步骤为 null。 */
  at: string | null;
  state: 'done' | 'current' | 'future';
}

/**
 * 「建议关注」的展开详情。四块内容与参考稿一一对应。
 *
 * `needParent` 由服务端判定：为 false 时前端**不得**渲染介入按钮，
 * 避免把「继续观察」渲染成「需要家长出手」。
 */
export interface ParentMessageFocus {
  headline: string;
  occurredAt: string;
  projectTitle: string | null;
  whatHappened: string;
  whatSystemDid: string;
  needParent: boolean;
  needParentNote: string;
  howYouCanHelp: string;
  timeline: ParentMessageTimelineStep[];
}

export interface ParentMessage {
  id: string;
  kind: ParentMessageKind;
  title: string;
  summary: string;
  occurredAt: string;
  status: ParentMessageStatus;
  projectTitle: string | null;
  focus: ParentMessageFocus | null;
}

export interface ParentServiceTicket {
  id: string;
  problem: string;
  projectTitle: string | null;
  owner: string;
  status: 'processing' | 'resolved';
  /** 服务端格式化的处理时长，例如「1小时25分钟」。 */
  handledIn: string;
}

export interface ParentMessagesSummary {
  total: number;
  pendingConfirm: number;
  processing: number;
  resolved: number;
}

export interface ParentMessagesPageData {
  childId: string;
  summary: ParentMessagesSummary;
  messages: ParentMessage[];
  tickets: ParentServiceTicket[];
  dataSource: DataSource;
}

/* ------------------------------------------------------------------ *
 * 写操作
 *
 * 参考稿上有三个写入口。三者都要求 `Idempotency-Key`：
 * 「发送鼓励」「标记已读 / 暂不提醒」「提交反馈」。重复提交不得产生第二条记录。
 * ------------------------------------------------------------------ */

/** 「给孩子一句鼓励」请求。长度 1..200，服务端必须再校验一次。 */
export interface SendEncouragementRequest {
  message: string;
}

export interface SendEncouragementResponse {
  id: string;
  sentAt: string;
  /**
   * 是否已送达孩子。家长给未成年人的留言**不直接推送**给孩子：
   * 先落库并留存审计，由服务端决定何时、以何种形式呈现。
   */
  delivered: boolean;
}

export type ParentMessageAckAction = 'read' | 'mute';

export interface ParentMessageAckRequest {
  action: ParentMessageAckAction;
}

export interface ParentMessageAckResponse {
  messageId: string;
  status: ParentMessageStatus;
  ackedAt: string;
}

/** 「提交反馈」/「我有疑问」/「就此问题反馈」共用一个入口，用 `source` 区分来源。 */
export type ParentFeedbackSource = 'general' | 'message' | 'project';

export interface SubmitParentFeedbackRequest {
  source: ParentFeedbackSource;
  /**
   * 目标孩子。
   *
   * 修复说明：旧实现由服务端**写死** `student-demo`，任何家长提交的工单都会
   * 挂到演示孩子名下，既是错误数据也是越权。现在 `general` 来源必填 `childId`；
   * `message` / `project` 来源可由被关联对象推导，但仍会与推导结果校验一致。
   */
  childId: string | null;
  content: string;
  /** `source` 为 `message` 或 `project` 时必填，用于把工单关联到具体对象。 */
  messageId: string | null;
  projectId: string | null;
  /** 已上传附件的 id 列表；服务端校验归属后才会写进工单。缺省视为无附件。 */
  attachmentRefs?: string[] | null;
}

export interface SubmitParentFeedbackResponse {
  ticketId: string;
  status: 'processing';
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * 统一反馈工单（家长与班主任共用同一份记录）
 *
 * 状态与时间线**只能由服务端迁移**：客户端的请求体里没有 `status` 字段，
 * 也无法指定事件类型。班主任只能看到自己当前学生的工单；家长只能看到自己
 * 绑定孩子的工单。
 * ------------------------------------------------------------------ */

/**
 * 统一工单状态。
 *
 * - `processing`：待班主任处理（家长刚提交或补充后）；
 * - `replied`：班主任已公开回复，等待家长确认；
 * - `resolved`：家长已确认问题解决；
 * - `reopened`：家长确认未解决，重新打开等待班主任。
 */
export type ParentFeedbackStatus = 'processing' | 'replied' | 'resolved' | 'reopened';

/** 工单时间线事件类型。全部由服务端根据动作写入，客户端不可指定。 */
export type ParentFeedbackEventKind =
  | 'submitted'
  | 'supplemented'
  | 'replied'
  | 'confirmed'
  | 'reopened';

/** 时间线中的一条记录；措辞由服务端预审，不含任何原始 AI 对话。 */
export interface ParentFeedbackEntry {
  id: string;
  kind: ParentFeedbackEventKind;
  authorRole: 'parent' | 'teacher';
  authorDisplayName: string;
  content: string;
  /** 附件引用 id；只包含已通过归属校验的附件。 */
  attachmentRefs: string[];
  /** 仅家长确认事件有值：true=确认已解决，false=确认未解决；其他事件为 null。 */
  resolved: boolean | null;
  createdAt: string;
}

/** 家长与班主任共用的工单投影。不含内部字段、负责人 id 与原始对话。 */
export interface ParentFeedbackTicket {
  id: string;
  /** 一般使用问题可以不关联孩子；其余来源必须由服务端推导并校验。 */
  childId: string | null;
  childDisplayName: string;
  source: ParentFeedbackSource;
  projectId: string | null;
  projectTitle: string | null;
  messageId: string | null;
  status: ParentFeedbackStatus;
  /** 家长首次提交的问题描述。 */
  problem: string;
  /** 当前负责人（班主任）展示名；尚未分配班主任时为 null。 */
  owner: string | null;
  /** 服务端格式化的处理时长，例如「2小时15分钟」。 */
  handledIn: string;
  entries: ParentFeedbackEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ParentFeedbackListResponse {
  tickets: ParentFeedbackTicket[];
}

export interface ParentFeedbackDetailResponse {
  ticket: ParentFeedbackTicket;
}

/** 家长补充说明（追问）请求；内容与首次提交同规则校验。 */
export interface SupplementParentFeedbackRequest {
  content: string;
  attachmentRefs?: string[] | null;
}

/** 家长确认结果请求。`resolved=true` 关闭工单；`false` 表示未解决，重新打开。 */
export interface ConfirmParentFeedbackRequest {
  resolved: boolean;
  note: string | null;
}

/** 工单变更后的统一响应（补充 / 确认 / 回复）。 */
export interface ParentFeedbackMutationResponse {
  ticket: ParentFeedbackTicket;
}

/* ------------------------------------------------------------------ *
 * 成长数据导出（ISSUE-T5 / #7）
 *
 * 服务端独占的家长成长导出契约。四条硬约束（继承自本文件顶部三条 + AGENTS.md）：
 *
 *  1. **对象级授权在请求与下载两处各校验一次**：下载时重新查 active 监护关系；
 *     授权被撤销后再下载返回 403，而不是空数据。
 *  2. **字段白名单投影**：导出正文只允许下面这些字段。原始 AI 对话、原始语音、
 *     内部风险标签、邮箱、任意模型推断都**不在**投影里，也不允许后续扩宽追加
 *     （新增字段必须走契约评审）。
 *  3. **写操作要求 `Idempotency-Key`**：同 key 重放返回第一次的任务，不产生第二条。
 *  4. **审计只记过程事实**（任务 id / 孩子 id / 状态 / 目的），不写导出正文。
 *
 * ⚠️ 当前是**同步生成 + 限时下载**的最小切片：任务元数据与脱敏正文落库，正文在
 * 请求时由服务端投影生成。异步 worker 与对象存储（大文件下载）尚未接入；未配置
 * 持久化时接口诚实返回 503，见 `services/api/src/modules/parent/growth-export.md`。
 * ------------------------------------------------------------------ */

/**
 * 导出任务状态。
 *
 * - `pending`：已受理、正文尚未生成（为未来异步 worker 预留；当前同步切片不产生）；
 * - `ready`：正文已生成，可在有效期内下载；
 * - `expired`：超出有效期，不再可下载。
 */
export type ParentGrowthExportStatus = 'pending' | 'ready' | 'expired';

/** 一次导出任务的元数据。**不含正文**——正文只在下载接口返回。 */
export interface ParentGrowthExportJob {
  exportId: string;
  childId: string;
  childDisplayName: string;
  status: ParentGrowthExportStatus;
  createdAt: string;
  expiresAt: string;
}

/**
 * 家长请求导出时**必须显式确认**的字段，用于挡住整包误导出 / 误操作。
 *
 * 这是最小化的「身份 + 对象」二次确认；更强的 step-up 认证（重新输入口令 /
 * 一次性验证码）依赖跨角色账户面，尚未接入，见 `growth-export.md` 的阻塞项。
 */
export interface ParentGrowthExportRequest {
  /** 必须与路径 `:childId` 完全一致；不一致服务端拒绝。 */
  confirmChildId: string;
  /** 必须与当前登录家长邮箱一致（大小写不敏感）。 */
  confirmGuardianEmail: string;
  /** 导出目的，1..200 字。审计记录该目的，但**不记录导出正文**。 */
  reason: string;
}

export interface ParentGrowthExportResponse {
  job: ParentGrowthExportJob;
}

/**
 * 导出正文的白名单条目。
 *
 * 与 `ParentGrowthEntry` 同形，但**独立冻结**：即使 `ParentGrowthEntry` 未来新增
 * 字段，导出投影也不会自动带出，必须在这份契约里显式加字段并通过评审。
 */
export interface ParentGrowthExportEntry {
  id: string;
  type: StudentGrowthEntryType;
  occurredAt: string;
  title: string;
  summaryParent: string;
  projectTitle: string | null;
  stage: ProjectStage | null;
  artifactRef: string | null;
}

/** 导出正文的过程性摘要；没有分数 / 排名 / 百分位 / 等级。 */
export interface ParentGrowthExportSummary {
  childId: string;
  childDisplayName: string;
  streakDays: number;
  projectsCompleted: number;
  objectivesMastered: number;
  artifactsPublished: number;
  lastActivityAt: string | null;
}

/** 家长可下载的成长导出正文。`schemaVersion` 固定为 `1`，变更时递增。 */
export interface ParentGrowthExportDocument {
  schemaVersion: 1;
  exportId: string;
  generatedAt: string;
  expiresAt: string;
  /** 条目是否被服务端上限截断；为 true 时前端应提示「仅含最近部分记录」。 */
  truncated: boolean;
  summary: ParentGrowthExportSummary;
  entries: ParentGrowthExportEntry[];
}

export interface ParentGrowthExportDownloadResponse {
  document: ParentGrowthExportDocument;
}
