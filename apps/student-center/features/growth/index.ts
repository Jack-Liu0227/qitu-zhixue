/**
 * 成长轨迹 (growth) student-center feature — public surface.
 *
 * Read-only: projects the STUDENT column of the shared server growth model.
 * The parent/teacher projections are a separate, unapproved proposal and are
 * deliberately not implemented here (growth-spec.md §4, 确认门 G4).
 *
 * The integrator wires `/student/growth` to a first-class nav item
 * (ADR 0004; 确认门 G1 resolved).
 */

export { GrowthPage, type GrowthPageProps } from './components/GrowthPage';
export { GrowthHeader } from './components/GrowthHeader';
export { GrowthSummaryCard } from './components/GrowthSummaryCard';
export { FilterBar, type GrowthFilterState } from './components/FilterBar';
export { TimelineRail } from './components/TimelineRail';
export { TimelineEntry } from './components/TimelineEntry';
export { MilestoneEntry } from './components/MilestoneEntry';
export { ArtifactEntry } from './components/ArtifactEntry';
export { ReflectionEntry } from './components/ReflectionEntry';
export { ObjectiveChip } from './components/ObjectiveChip';
export { ObservationNote } from './components/ObservationNote';
export { EntryDetailSheet } from './components/EntryDetailSheet';
export { VersionStep, type VersionStepTone } from './components/VersionStep';
export { ReflectionQuote } from './components/ReflectionQuote';
export {
  GrowthLoadingView,
  GrowthEmptyView,
  GrowthErrorView,
  GrowthPermissionView,
} from './components/GrowthStateViews';

export {
  GROWTH_STUDENT_PROJECTION_GATE,
  rewordRiskSignal,
  type GrowthStudentProjectionGate,
  type RewordableRiskSignal,
} from './projection-gate';

export {
  createGrowthDataSource,
  growthDataSource,
  createMockGrowthDataSource,
  resetGrowthCache,
  projectStudentEntry,
  projectStudentTimeline,
  GrowthDataSourceError,
  GrowthOfflineError,
  GrowthPermissionError,
  type GrowthDataSource,
  type MockGrowthScenario,
} from './data';

export {
  createDefaultGrowthQuery,
  EMPTY_GROWTH_SUMMARY,
  type GrowthEvidenceSourceKind,
  type GrowthObservationState,
  type GrowthProjectOption,
  type StudentGrowthEntry,
  type StudentGrowthEntryType,
  type StudentGrowthFilterType,
  type StudentGrowthIcon,
  type StudentGrowthPageData,
  type StudentGrowthQuery,
  type StudentGrowthSummary,
  type StudentGrowthTimeline,
} from './types';
