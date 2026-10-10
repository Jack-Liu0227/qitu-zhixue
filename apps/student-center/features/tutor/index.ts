/**
 * Public surface of the student-center 「AI搭档」 (tutor) feature module.
 *
 * The public boundary is intentionally small: routes compose the feature through
 * this index while components stay independent of transport details.
 */

// Page container
export { TutorPage } from './TutorPage';
export { TutorDataSourceProvider, useTutorDataSource } from './TutorDataSourceProvider';

// Components
export { ChatBubble } from './components/ChatBubble';
export { ChatThread } from './components/ChatThread';
export { Composer } from './components/Composer';
export { CurrentTask } from './components/CurrentTask';
export { EvidenceChip } from './components/EvidenceChip';
export { HintLevelIndicator } from './components/HintLevelIndicator';
export { NumberedQuestionList } from './components/NumberedQuestionList';
export { OptionChips } from './components/OptionChips';
export { ProjectCard } from './components/ProjectCard';
export { ProjectContextPanel } from './components/ProjectContextPanel';
export { SafeReplyFallback, TutorReplyBlockView } from './components/TutorReplyBlockView';
export { StageProgress } from './components/StageProgress';
export { StreamCaret, ToolCallStep, ToolCallTimeline } from './components/ToolCallTimeline';
export { TypingIndicator } from './components/TypingIndicator';
export { TutorHeader } from './components/TutorHeader';

// Hooks
export { useComposer } from './hooks/useComposer';
export { useTutorSession } from './hooks/useTutorSession';

// Realtime
export { TutorRealtimeClient } from './realtime/tutorRealtimeClient';
export type {
  TutorRealtimeOptions,
  TutorRealtimeStatus,
  TutorSocket,
  TutorSocketFactory,
} from './realtime/tutorRealtimeClient';

// Data source (single swappable seam)
export {
  getTutorDataSource,
  setTutorDataSource,
  LiveTutorSocket,
  MockTutorDataSource,
  TutorApiDataSource,
  TutorDataError,
  openTutorStream,
  TUTOR_STREAM_PATH,
} from './data';
export type { TutorDataSource, MockTutorScenario, TutorStreamHandlers, TutorStreamRequest } from './data';

// Pure logic / contracts
export {
  CONTINUOUS_GUIDANCE_TURN_CAP,
  EXPLAIN_ONLY_LEVEL,
  HINT_LEVEL_MAX,
  HINT_LEVEL_MIN,
  HINT_PATH_MAX_LEVEL,
  MAX_HINT_RISE_PER_TURN,
  PEDAGOGIC_MOVES,
  SCAFFOLD_LEVEL,
  STALL_WINDOW_SIZE,
  deriveGuidanceRun,
} from './pedagogy';
export {
  applyServerEventToTurns,
  isDuplicateSeq,
  isTutorReplyBlock,
  isTutorToolCall,
  sortTurnsBySeq,
} from './state';
export { collectToolCalls, createStudentEchoTurn, dropTurn, findRunningToolLabel } from './state';
export { createIdempotencyKey } from './idempotency';
export type {
  TutorConnectionStatus,
  TutorCurrentTask,
  TutorEscalationState,
  TutorLoadStatus,
  TutorProjectContext,
  TutorViewError,
} from './types';
