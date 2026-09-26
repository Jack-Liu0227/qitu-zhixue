/**
 * Student-center 「今天」 feature module (route `/student/today`).
 *
 * Wave 4 route wiring mounts these exports; this module never touches `app/**`
 * or the frozen navigation. Server-owned state is read-only here.
 */
export { TodayPage } from './components/TodayPage';
export type { TodayPageProps } from './components/TodayPage';
export { TodayGreetingBanner } from './components/TodayGreetingBanner';
export { TodayHeader } from './components/TodayHeader';
export { TodayLoading } from './components/TodayLoading';
export { IdeaStartSection } from './components/IdeaStartSection';
export { DirectionCard } from './components/DirectionCard';
export { ContinueProjectCard } from './components/ContinueProjectCard';
export { StageStepper4 } from './components/StageStepper4';
export { TodayTaskCard } from './components/TodayTaskCard';
export { TaskCard } from './components/TaskCard';
export { AiSuggestionCard } from './components/AiSuggestionCard';
export { SuggestionCard } from './components/SuggestionCard';

export { useTodayData } from './hooks/useTodayData';
export type {
  UseTodayDataOptions,
  UseTodayDataResult,
  TodayPageState,
  TodayRegionState,
} from './hooks/useTodayData';

export { todayDataSource, createMockTodayDataSource } from './data';
export type { TodayDataSource, TodayScenario, MockTodayDataSourceOptions } from './data';

export type {
  TodayView,
  TodayTask,
  TodayTaskStatus,
  TodaySuggestion,
  IdeaDirection,
  QuickStartInfo,
  LearningStats,
  ActiveProjectSummary,
  ProjectStageView,
  NotificationItem,
  NotificationList,
} from './types';
