import type {
  ParentGrowthEntry,
  ParentGrowthExportDocument,
  ParentGrowthExportEntry,
  ParentGrowthExportSummary,
  ParentGrowthSummary,
} from '@qitu/contracts';
import type { GrowthExportAccessDecision, GrowthExportAccessInput } from './growth-export.types';

/**
 * 家长成长导出的**纯函数**层：字段白名单投影 + 状态 / 授权判定。
 *
 * 这里没有任何 IO，因此可以被穷举单测。两个函数是导出的安全边界：
 *  - `buildParentGrowthExportDocument` 只从输入里**显式挑选**允许的字段，
 *    即使上游投影对象被扩宽，也不会带出未列入白名单的字段；
 *  - `decideGrowthExportAccess` 把「归属 / 授权 / 状态 / 有效期」压成一个
 *    可枚举结果，服务层据此只做 HTTP 翻译，不重新发明判定。
 */

export interface BuildParentGrowthExportInput {
  exportId: string;
  childId: string;
  childDisplayName: string;
  generatedAt: Date;
  expiresAt: Date;
  /** 服务端家长投影摘要。 */
  summary: ParentGrowthSummary;
  /** 服务端家长投影时间线条目。 */
  entries: readonly ParentGrowthEntry[];
  /** 条目是否因服务端上限被截断。 */
  truncated: boolean;
}

/**
 * 生成脱敏导出正文。
 *
 * 这是**白名单**而不是黑名单：不复制输入对象，而是逐字段重建。因此
 * `rawConversation` / `voiceTranscript` / `riskLevel` / `email` / `modelInference`
 * 之类字段即使出现在输入里也不会进入结果。
 */
export function buildParentGrowthExportDocument(
  input: BuildParentGrowthExportInput,
): ParentGrowthExportDocument {
  return {
    schemaVersion: 1,
    exportId: input.exportId,
    generatedAt: input.generatedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    truncated: input.truncated,
    summary: projectSummary(input.summary, input.childDisplayName),
    entries: input.entries.map(projectEntry),
  };
}

function projectSummary(
  summary: ParentGrowthSummary,
  childDisplayName: string,
): ParentGrowthExportSummary {
  return {
    childId: summary.childId,
    childDisplayName,
    streakDays: summary.streakDays,
    projectsCompleted: summary.projectsCompleted,
    objectivesMastered: summary.objectivesMastered,
    artifactsPublished: summary.artifactsPublished,
    lastActivityAt: summary.lastActivityAt,
  };
}

function projectEntry(entry: ParentGrowthEntry): ParentGrowthExportEntry {
  return {
    id: entry.id,
    type: entry.type,
    occurredAt: entry.occurredAt,
    title: entry.title,
    summaryParent: entry.summaryParent,
    projectTitle: entry.projectTitle,
    stage: entry.stage,
    artifactRef: entry.artifactRef,
  };
}

/**
 * 判定一次下载是否可行。
 *
 * 顺序即优先级：
 *  1. 记录不存在，或不属于当前访问者 → `not_found`（不泄露他人导出是否存在）；
 *  2. 无 active 监护关系 → `forbidden`（授权被撤销后 403，而不是空数据）；
 *  3. 正文尚未生成 → `not_ready`；
 *  4. 已过期（状态或时间）→ `expired`；
 *  5. 其余 → `ok`。
 */
export function decideGrowthExportAccess(input: GrowthExportAccessInput): GrowthExportAccessDecision {
  const { record } = input;
  if (record === null) return 'not_found';
  if (record.parentId !== input.actorId) return 'not_found';
  if (!input.guardianActive) return 'forbidden';
  if (record.status === 'pending') return 'not_ready';
  if (record.status === 'expired' || record.expiresAt.getTime() <= input.now.getTime()) {
    return 'expired';
  }
  return 'ok';
}
