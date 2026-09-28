import { createHash } from 'node:crypto';
import type { ProjectStage, StudentGrowthEntryType } from '@qitu/contracts';
import { normaliseEvidenceIds } from './growth.evidence';

/**
 * 成长档案的**规范化记录**与纯函数。
 *
 * 这是 `growth_records`（迁移 0008 / ADR 0006）在 API 侧的领域形态：
 *  - 记录由服务端产生、只追加（append-only），没有客户端写路径；
 *  - `evidenceIds` 是经白名单归一化的不透明引用，绝不承载原始对话 / 语音；
 *  - `summaryStudent` / `summaryParent` 是两条独立、预审过的措辞；
 *  - `source` / `visibility` 由服务端决定，客户端不可写。
 *
 * 这些函数不依赖 Nest / 数据库，便于直接单测；Postgres 适配器只负责把
 * `GrowthStoredRecord` 映射到表行，把映射逻辑留在这里可独立验证。
 */

/** 只有这四类记录会进入学生 / 家长投影（与契约 `StudentGrowthEntryType` 一致）。 */
export const STUDENT_FACING_GROWTH_TYPES = [
  'project_stage_completed',
  'artifact_published',
  'reflection_created',
  'objective_mastered',
] as const satisfies readonly StudentGrowthEntryType[];

const STUDENT_FACING_TYPE_SET: ReadonlySet<string> = new Set(STUDENT_FACING_GROWTH_TYPES);

/**
 * 记录产生来源。服务端内部调用可以声明是 AI搭档 / 班主任触发，但**客户端**
 * 永远不能写；HTTP 层没有写接口，且控制器不暴露来源字段。
 */
export const GROWTH_RECORD_SOURCES = ['server', 'tutor', 'mentor'] as const;
export type GrowthRecordSource = (typeof GROWTH_RECORD_SOURCES)[number];

/** 可见性：默认学生私有；家长 / 班主任可见仅是**投影**允许，不是明文共享。 */
export const GROWTH_RECORD_VISIBILITIES = [
  'student_private',
  'guardian_visible',
  'mentor_visible',
] as const;
export type GrowthRecordVisibility = (typeof GROWTH_RECORD_VISIBILITIES)[number];

const SOURCE_SET: ReadonlySet<string> = new Set(GROWTH_RECORD_SOURCES);
const VISIBILITY_SET: ReadonlySet<string> = new Set(GROWTH_RECORD_VISIBILITIES);

/** 服务端写入入参（`GrowthService.record` 的输入）。 */
export interface GrowthRecordInput {
  studentId: string;
  type: StudentGrowthEntryType;
  occurredAt: string;
  title: string;
  summaryStudent: string;
  summaryParent: string;
  projectId?: string | null;
  /** 只用于展示的标题快照；规范表只存 `project_id`，标题由读模型补齐。 */
  projectTitle?: string | null;
  stage?: ProjectStage | null;
  artifactRef?: string | null;
  objectiveTitles?: string[];
  encouragement?: string | null;
  /**
   * 服务端证据引用（`sourceKind:opaqueId`）。调用方传入的值会被白名单归一化；
   * 非法 / 未知来源被静默丢弃，绝不影响记录本身的写入。
   */
  evidenceIds?: string[];
  /**
   * 幂等键。调用方应传**稳定**的自然键（如「同一阶段完成 / 同一作品发布」）；
   * 缺省时由内容派生。相同键的重试在存储层只落一条。
   */
  idempotencyKey?: string;
  source?: GrowthRecordSource;
  visibility?: GrowthRecordVisibility;
  schoolId?: string | null;
}

/** 规范记录的领域形态（内存读快照 + Postgres 行之间的统一表示）。 */
export interface GrowthStoredRecord {
  id: string;
  schoolId: string | null;
  studentId: string;
  projectId: string | null;
  projectTitle: string | null;
  type: StudentGrowthEntryType;
  occurredAt: string;
  title: string;
  summaryStudent: string;
  summaryParent: string;
  stage: ProjectStage | null;
  artifactRef: string | null;
  objectiveTitles: string[];
  evidenceIds: string[];
  encouragement: string | null;
  source: GrowthRecordSource;
  visibility: GrowthRecordVisibility;
  idempotencyKey: string;
  createdAt: string;
}

/** 判断数据库里的 `type` 是否是学生 / 家长投影支持的闭合集合。 */
export function isStudentFacingGrowthType(value: string): value is StudentGrowthEntryType {
  return STUDENT_FACING_TYPE_SET.has(value);
}

/** 归一化来源；未知值一律回落到 `server`，绝不透传。 */
export function normaliseGrowthSource(value: unknown): GrowthRecordSource {
  return typeof value === 'string' && SOURCE_SET.has(value)
    ? (value as GrowthRecordSource)
    : 'server';
}

/** 归一化可见性；未知值一律回落到最小可见 `student_private`。 */
export function normaliseGrowthVisibility(value: unknown): GrowthRecordVisibility {
  return typeof value === 'string' && VISIBILITY_SET.has(value)
    ? (value as GrowthRecordVisibility)
    : 'student_private';
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:._-]{1,200}$/;

/** 归一化显式幂等键；非法 / 空则返回 `null`，由内容派生兜底。 */
export function normaliseIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return IDEMPOTENCY_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * 由内容派生稳定的幂等键。
 *
 * 对「同一阶段完成 / 同一作品发布 / 同一目标掌握 / 同一反思」这类自然事件，
 * 内容本身就是身份，因此重试会得到同一个键、存储层只落一条。反思没有更强的
 * 自然键，用 `occurredAt` 区分。
 */
export function deriveGrowthIdempotencyKey(input: GrowthRecordInput): string {
  const scope = input.studentId;
  switch (input.type) {
    case 'artifact_published':
      return `growth:artifact_published:${scope}:${input.artifactRef ?? input.occurredAt}`;
    case 'project_stage_completed':
      return `growth:project_stage_completed:${scope}:${input.projectId ?? '-'}:${input.stage ?? '-'}`;
    case 'objective_mastered': {
      const titles = [...(input.objectiveTitles ?? [])].sort().join('|');
      return `growth:objective_mastered:${scope}:${titles.length > 0 ? titles : input.title}`;
    }
    case 'reflection_created':
      return `growth:reflection_created:${scope}:${input.occurredAt}`;
  }
}

/** 记录 id 由幂等键确定性派生：崩溃后重放同一键不会产生第二个 id。 */
export function deriveGrowthRecordId(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24);
  return `growth-${digest}`;
}

/**
 * 把服务端入参规范化为可持久化的记录。
 *
 * 关键安全点：证据引用经白名单归一化，来源 / 可见性经枚举归一化。任何客户端
 * 传入的原始文本、模型标签都不在这里的字段集合中，因此无法进入成长档案。
 */
export function buildGrowthStoredRecord(
  input: GrowthRecordInput,
  createdAt: string,
): GrowthStoredRecord {
  const evidenceIds = normaliseEvidenceIds(input.evidenceIds);
  const idempotencyKey =
    normaliseIdempotencyKey(input.idempotencyKey) ?? deriveGrowthIdempotencyKey(input);

  return {
    id: deriveGrowthRecordId(idempotencyKey),
    schoolId: input.schoolId ?? null,
    studentId: input.studentId,
    projectId: input.projectId ?? null,
    projectTitle: input.projectTitle ?? null,
    type: input.type,
    occurredAt: input.occurredAt,
    title: input.title,
    summaryStudent: input.summaryStudent,
    summaryParent: input.summaryParent,
    stage: input.stage ?? null,
    artifactRef: input.artifactRef ?? null,
    objectiveTitles: [...(input.objectiveTitles ?? [])],
    evidenceIds,
    encouragement: input.encouragement ?? null,
    source: normaliseGrowthSource(input.source),
    visibility: normaliseGrowthVisibility(input.visibility),
    idempotencyKey,
    createdAt,
  };
}

/** 复制记录，避免读快照与存储内部状态共享可变数组。 */
export function cloneGrowthStoredRecord(record: GrowthStoredRecord): GrowthStoredRecord {
  return {
    ...record,
    objectiveTitles: [...record.objectiveTitles],
    evidenceIds: [...record.evidenceIds],
  };
}
