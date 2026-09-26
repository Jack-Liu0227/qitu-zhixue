import type { StudentGrowthQuery, StudentGrowthSummary } from '@qitu/contracts';

/**
 * Student-center 成长轨迹 (growth) — student-projection view types.
 *
 * The shared server growth-record model (growth-spec.md §3) is projected
 * differently for 学生 / 家长 / 班主任 (matrix §4, currently an UNAPPROVED
 * proposal). This module implements the STUDENT projection ONLY.
 *
 * The types are declared in `@qitu/contracts` (single source of truth) and
 * re-exported here so module-internal imports stay short. They are deliberately
 * NARROWER than the shared model: no `summaryParent`, `summaryMentor`,
 * `riskSignal`, `visibility`, or audit fields, and `StudentGrowthEntryType`
 * cannot even represent a guardian/mentor/tutor/escalation entry.
 */
export type {
  GrowthProjectOption,
  StudentGrowthEntry,
  StudentGrowthEntryType,
  StudentGrowthFilterType,
  StudentGrowthIcon,
  StudentGrowthPageData,
  StudentGrowthQuery,
  StudentGrowthSummary,
  StudentGrowthTimeline,
} from '@qitu/contracts';

export const EMPTY_GROWTH_SUMMARY: StudentGrowthSummary = {
  streakDays: 0,
  projectsCompleted: 0,
  objectivesMastered: 0,
  artifactsPublished: 0,
};

export function createDefaultGrowthQuery(
  overrides?: Partial<Pick<StudentGrowthQuery, 'type' | 'projectId'>>,
): StudentGrowthQuery {
  return {
    type: overrides?.type ?? 'all',
    projectId: overrides?.projectId ?? null,
    from: null,
    to: null,
    cursor: null,
    limit: 20,
  };
}
