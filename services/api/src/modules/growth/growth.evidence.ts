import type { GrowthEvidenceSourceKind, GrowthObservationState } from '@qitu/contracts';

/**
 * 成长证据引用的服务端白名单与归一化（T3 / #5，产品文档 §4.7）。
 *
 * 设计要点：
 *  - 证据引用是**不透明**的 `sourceKind:opaqueId`，绝不承载原始对话 / 语音内容。
 *  - 只有 `GROWTH_EVIDENCE_SOURCE_KINDS` 里的来源种类会被保留；其它一律丢弃。
 *  - 单条记录的证据条数有上限，避免响应无界增长。
 *  - 观察状态由证据有无**推导**，不存在「没有证据 → 0 分」的默认路径。
 *
 * 这是一个纯模块：不依赖 Nest / 数据库，便于直接单测。
 */

/** 服务端认可的证据来源种类白名单（与契约 `GrowthEvidenceSourceKind` 一一对应）。 */
export const GROWTH_EVIDENCE_SOURCE_KINDS = [
  'student_answer',
  'theory_check',
  'artifact',
  'reflection',
  'help_request',
] as const satisfies readonly GrowthEvidenceSourceKind[];

const KIND_SET: ReadonlySet<string> = new Set(GROWTH_EVIDENCE_SOURCE_KINDS);

/** 单条成长记录最多保留的证据引用数；超出部分丢弃。 */
export const MAX_EVIDENCE_IDS_PER_ENTRY = 32;

/** 单个引用（含 kind 前缀）的最大长度。 */
export const MAX_EVIDENCE_ID_LENGTH = 160;

/** 不透明 id 允许的字符集：字母、数字、`-`、`_`、`.`；不允许空白与冒号。 */
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const KIND_SEPARATOR = ':';

export interface ParsedEvidenceId {
  sourceKind: GrowthEvidenceSourceKind;
  opaqueId: string;
}

/**
 * 解析并校验一个证据引用 `sourceKind:opaqueId`。
 *
 * 返回 `null` 表示来源种类不在白名单、格式非法或超长——调用方必须丢弃。
 */
export function parseEvidenceId(raw: unknown): ParsedEvidenceId | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_EVIDENCE_ID_LENGTH) return null;

  const separator = raw.indexOf(KIND_SEPARATOR);
  if (separator <= 0 || separator === raw.length - 1) return null;

  const sourceKind = raw.slice(0, separator);
  const opaqueId = raw.slice(separator + 1);
  if (!KIND_SET.has(sourceKind)) return null;
  if (!OPAQUE_ID_PATTERN.test(opaqueId)) return null;

  return { sourceKind: sourceKind as GrowthEvidenceSourceKind, opaqueId };
}

/**
 * 服务端白名单归一化：只保留合法引用，去重（保序），并限制条数。
 *
 * 客户端传入的任何值都在这里被过滤，绝不会直接透传进成长档案。
 */
export function normaliseEvidenceIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of input) {
    if (result.length >= MAX_EVIDENCE_IDS_PER_ENTRY) break;
    if (parseEvidenceId(candidate) === null) continue;
    const ref = candidate as string;
    if (seen.has(ref)) continue;
    seen.add(ref);
    result.push(ref);
  }
  return result;
}

/**
 * 由证据有无推导观察状态：没有证据 → `pending_observation`（「待观察」）。
 *
 * 该函数是「无证据不得填 0」这条规则的唯一落点。
 */
export function observationStateFor(evidenceIds: readonly string[]): GrowthObservationState {
  return evidenceIds.length > 0 ? 'observed' : 'pending_observation';
}
