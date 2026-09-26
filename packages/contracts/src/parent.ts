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
  content: string;
  /** `source` 为 `message` 或 `project` 时必填，用于把工单关联到具体对象。 */
  messageId: string | null;
  projectId: string | null;
}

export interface SubmitParentFeedbackResponse {
  ticketId: string;
  status: 'processing';
  createdAt: string;
}
