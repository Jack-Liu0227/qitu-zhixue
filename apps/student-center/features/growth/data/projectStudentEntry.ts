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
