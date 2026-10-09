/**
 * 公开站点（营销首页）契约。
 *
 * 与其它契约的区别：这里的所有响应都由**未登录**访客获取，因此
 * 服务端投影必须自己承担「不泄露未成年人数据」的责任——
 * 只出聚合计数与**平台共享**（`school_id IS NULL`）的已发布模板，
 * 不出任何学生 / 家长 / 教师标识，也不出校属模板。
 */

/**
 * 首页展示的聚合统计。
 *
 * 每个字段都对应服务端一次 `count(...)`，**不接受客户端输入**：
 * 数字不真实比数字难看更糟，因此没有数据库来源的营销文案
 * （如满意度评分）由前端静态标注，不混进这里。
 */
export interface PublicHomeStats {
  /** 有效（未停用）学生账号数。 */
  learners: number;
  /** 有效（`active`）学校数。 */
  schools: number;
  /** 平台共享且已发布的项目模板数。 */
  publishedTemplates: number;
  /** 已发布且可见范围超出「仅本人 / 仅导师 / 仅班级」的作品数。 */
  publishedWorks: number;
}

/** 模板阶段（与 `TemplateStage` 同形，公开投影只出 id / label）。 */
export interface PublicHomeStage {
  id: string;
  label: string;
}

/**
 * 首页项目展厅卡片。
 *
 * 只出模板本身的公开字段；`version` / `publishedAt` 取该模板**最新已发布版本**，
 * 与 `TemplatesService` 的「当前版本」判定保持一致。
 */
export interface PublicHomeTemplate {
  id: string;
  slug: string;
  title: string;
  summary: string;
  domain: string | null;
  ageRange: string | null;
  difficulty: string | null;
  estimatedDurationMinutes: number | null;
  outcomeForm: string | null;
  learningObjectives: string[];
  stages: PublicHomeStage[];
  /** 最新已发布版本号，例如 `v1`；没有已发布版本时为 `null`。 */
  version: string | null;
  /** 最新已发布版本的发布时间（ISO 8601）。 */
  publishedAt: string | null;
  /**
   * 基于该模板建立过项目的**学生人数**（去重聚合）。
   *
   * 是聚合计数，不是学生列表；同一学生的多个项目只算一次。
   */
  participants: number;
}

/** `GET /api/v1/public/home` 的响应体。 */
export interface PublicHomeView {
  stats: PublicHomeStats;
  templates: PublicHomeTemplate[];
  /** 服务端生成时间（ISO 8601），便于前端显示数据新鲜度。 */
  generatedAt: string;
}

/** 咨询表单的咨询身份。 */
export type ConsultationIdentity = 'student' | 'parent' | 'school';

/**
 * 公开咨询（预约体验课 / 院校机构合作）入参。
 *
 * `name` / `phone` 是唯一收集的个人信息；**不得**要求身份证号、
 * 学生姓名以外的未成年人信息等超范围字段。
 */
export interface ConsultationRequestInput {
  name: string;
  phone: string;
  identity: ConsultationIdentity;
  /** 可选留言；空字符串按未填写处理。 */
  message?: string | null;
}

/** 咨询提交回执。只回服务端生成的 id 与状态，不回显个人信息。 */
export interface ConsultationReceipt {
  id: string;
  status: 'received';
  createdAt: string;
}
