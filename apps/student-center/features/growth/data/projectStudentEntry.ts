import {
  GROWTH_STUDENT_PROJECTION_GATE,
  rewordRiskSignal,
  type RewordableRiskSignal,
} from '../projection-gate';
import type {
  StudentGrowthEntry,
  StudentGrowthEntryType,
  StudentGrowthIcon,
  StudentGrowthTimeline,
} from '../types';
import type { InternalGrowthRecord } from './growthFixtures';

const ICON_BY_TYPE: Record<StudentGrowthEntryType, StudentGrowthIcon> = {
  project_stage_completed: 'stage',
  artifact_published: 'artifact',
  reflection_created: 'reflection',
  objective_mastered: 'objective',
};

const STUDENT_VISIBLE_TYPES: readonly StudentGrowthEntryType[] = [
  'project_stage_completed',
  'artifact_published',
  'reflection_created',
  'objective_mastered',
];

const REWORDABLE_SIGNALS: readonly RewordableRiskSignal[] = [
  'stall',
  'emotion',
  'escalated',
  'no_progress',
];

/** 学生视图只接受白名单内的证据来源；与服务端 `growth.evidence.ts` 保持一致。 */
const VISIBLE_EVIDENCE_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'student_answer',
  'theory_check',
  'artifact',
  'reflection',
  'help_request',
]);

/**
 * 客户端侧的证据引用防御：只保留 `sourceKind:opaqueId` 且来源在白名单内的
 * 引用。真实白名单由服务端执行；这里只是让学生 mock 也无法渲染原始字段。
 */
function visibleEvidenceIds(ids: readonly string[]): string[] {
  return ids.filter((id) => {
    const separator = id.indexOf(':');
    if (separator <= 0 || separator === id.length - 1) return false;
    return VISIBLE_EVIDENCE_SOURCE_KINDS.has(id.slice(0, separator));
  });
}

function isStudentVisibleType(type: string): type is StudentGrowthEntryType {
  return (STUDENT_VISIBLE_TYPES as readonly string[]).includes(type);
}

function isRewordableSignal(signal: string): signal is RewordableRiskSignal {
  return (REWORDABLE_SIGNALS as readonly string[]).includes(signal);
}

/**
 * Projects one server growth record into the narrow student view.
 *
 * Returns `null` for any record whose source type is not one of the four
 * child-visible categories, so guardian feedback, mentor notes, tutor records
 * and escalation events cannot reach a component. Adult-only fields
 * (`summaryParent`, `summaryMentor`, `riskSignal`) are never copied.
 *
 * Internal risk labels are read ONLY here and ONLY through
 * `rewordRiskSignal`, and only when the projection gate says the child may see
 * reworded signals. The result is pre-approved wording or `null` — never a raw
 * label and never a count.
 *
 * `evidenceIds` are passed through a client-side allowlist mirror of the server
 * whitelist (`sourceKind:opaqueId`); `observationState` is derived from the
 * surviving refs, so an entry with no evidence becomes `pending_observation`
 * (「待观察」) rather than an implicit zero.
 */
export function projectStudentEntry(record: InternalGrowthRecord): StudentGrowthEntry | null {
  if (!isStudentVisibleType(record.type)) {
    return null;
  }
  if (GROWTH_STUDENT_PROJECTION_GATE.withheldSourceTypes.includes(record.type)) {
    return null;
  }

  const signal = isRewordableSignal(record.riskSignal) ? record.riskSignal : null;
  const encouragement =
    GROWTH_STUDENT_PROJECTION_GATE.studentRiskSignals === 'reworded'
      ? rewordRiskSignal(signal)
      : null;
  const evidenceIds = visibleEvidenceIds(record.evidenceIds);

  return {
    id: record.id,
    type: record.type,
    occurredAt: record.occurredAt,
    title: record.title,
    summaryStudent: record.summaryStudent,
    projectId: record.projectId,
    projectTitle: record.projectTitle,
    stage: record.stage,
    artifactRef: record.artifactRef,
    objectiveTitles: [...record.objectiveTitles],
    icon: ICON_BY_TYPE[record.type],
    encouragement,
    evidenceIds,
    // 「无证据 → 待观察」：绝不能把没有数据画成 0 分或负面结论。
    observationState: evidenceIds.length > 0 ? 'observed' : 'pending_observation',
  };
}

export function projectStudentTimeline(
  records: readonly InternalGrowthRecord[],
): StudentGrowthTimeline {
  const items = records
    .map(projectStudentEntry)
    .filter((entry): entry is StudentGrowthEntry => entry !== null)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return { items, nextCursor: null, hasNext: false };
}
