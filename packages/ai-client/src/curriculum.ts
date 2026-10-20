import type {
  KnowledgeType,
  LearningPlanErrorCode,
  NextAction,
  SessionBlockKind,
  SessionMode,
} from '@qitu/contracts';

/** Lesson-first curriculum primitives. Calendar placement is intentionally absent. */
export const CURRICULUM_TEMPLATE_VERSION = 'curriculum-plan-v1';
export const CURRICULUM_PROMPT_VERSIONS = { explore: 'curriculum-explore-v1', plan: 'curriculum-plan-v1' } as const;
export const CURRICULUM_EXPLORATION_BRAND = 'curriculum-exploration-v1';
export const MINUTES_PER_SESSION = 60;
export const MAX_OBJECTIVES_PER_SESSION = 4;
export const MAX_OBJECTIVE_LENGTH = 120;
export const MIN_INTEREST_LENGTH = 1;
export const MAX_INTEREST_LENGTH = 60;
export const MAX_GOAL_LENGTH = 200;
export const MIN_LESSON_COUNT = 1;
export const MAX_LESSON_COUNT = 128;
export const LESSON_COUNT_OPTIONS = [4, 8, 16] as const;
export const DEFAULT_PRIOR_KNOWLEDGE = 'none';
export const DEFAULT_TARGET_LEVEL = 'beginner';
export const DEFAULT_TIME_BUDGET_MINUTES = MINUTES_PER_SESSION;
export const CURRICULUM_EPOCH = '1970-01-01T00:00:00.000Z';
export const THEORY_KNOWLEDGE_TYPES: readonly KnowledgeType[] = ['memory', 'concept'];
export const PRACTICE_KNOWLEDGE_TYPES: readonly KnowledgeType[] = ['procedure', 'design'];
export const ABILITY_MARKERS: readonly string[] = ['explain', 'compare', 'design', 'measure', 'model', 'test', 'revise', 'present'];

type LessonCount = number;

export class CurriculumPlanError extends Error {
  readonly errors: readonly CurriculumValidationError[];
  constructor(readonly code: LearningPlanErrorCode, message: string, errors: readonly CurriculumValidationError[] = []) {
    super(message);
    this.name = 'CurriculumPlanError';
    this.errors = errors;
  }
}

export interface CurriculumValidationError { path: string; message: string }
export interface CurriculumValidationResult { ok: boolean; errors: readonly CurriculumValidationError[] }

export interface CurriculumIntakeProfile {
  priorKnowledge?: string | null;
  targetLevel?: string | null;
  timeBudgetMinutes?: number | null;
  preferences?: readonly string[] | null;
}
export interface CurriculumNormalizedIntakeProfile {
  priorKnowledge: string;
  targetLevel: string;
  timeBudgetMinutes: number;
  preferences: readonly string[];
  degradedFields: readonly string[];
}
export interface CurriculumExploreInput {
  interest: string;
  lessonCount: LessonCount;
  lessonMinutes?: 60 | 120;
  goal?: string | null;
  profile?: CurriculumIntakeProfile | null;
  seed?: number;
  now?: string | Date;
}
export interface CurriculumExploration {
  readonly phase: 'explore';
  readonly brand: typeof CURRICULUM_EXPLORATION_BRAND;
  readonly profileVersion: string;
  readonly interest: string;
  readonly lessonCount: LessonCount;
  readonly lessonMinutes: 60 | 120;
  readonly goal: string;
  readonly goalIsDefaulted: boolean;
  readonly profile: CurriculumNormalizedIntakeProfile;
  readonly interestTags: readonly string[];
  readonly clarifyingQuestions: readonly string[];
  readonly missingIntakeFields: readonly string[];
  readonly exploredAt: string;
  readonly seed: number;
}
export interface CurriculumExplorationSnapshot {
  readonly phase: 'explore';
  readonly brand: typeof CURRICULUM_EXPLORATION_BRAND;
  readonly profileVersion: string;
  readonly exploredAt: string;
  readonly seed: number;
  readonly interest: string;
  readonly lessonCount: LessonCount;
  readonly lessonMinutes: 60 | 120;
  readonly missingIntakeFields: readonly string[];
  readonly clarifyingQuestions: readonly string[];
}

export interface CurriculumObjective {
  id: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  objective: string;
  prerequisiteIds: readonly string[];
  ordinal: number;
}
export interface CurriculumSessionBlock {
  id: string;
  kind: SessionBlockKind;
  minutes: number;
  objectiveIds: readonly string[];
  prerequisiteObjectiveIds: readonly string[];
}
export interface CurriculumSession {
  id: string;
  moduleId: string;
  index: number;
  lessonIndex: number;
  title: string;
  mode: SessionMode;
  blocks: readonly CurriculumSessionBlock[];
  theoryObjectiveIds: readonly string[];
  practiceObjectiveIds: readonly string[];
}
export interface CurriculumModule {
  id: string;
  name: string;
  lessonIndex: number;
  objective: string;
  ordinal: number;
}
export interface CurriculumPlanDraft {
  readonly phase: 'plan';
  readonly templateVersion: string;
  readonly lessonCount: LessonCount;
  readonly lessonMinutes: 60 | 120;
  readonly minutesPerSession: 60 | 120;
  readonly title: string;
  readonly interest: string;
  readonly goal: string;
  readonly projectId: null;
  readonly modules: readonly CurriculumModule[];
  readonly objectives: readonly CurriculumObjective[];
  readonly sessions: readonly CurriculumSession[];
  readonly exploration: CurriculumExplorationSnapshot;
  readonly generatedAt: string;
  readonly seed: number;
}
export interface CurriculumConfirmedPlan extends Omit<CurriculumPlanDraft, 'projectId'> { readonly projectId: string; readonly confirmedAt: string; readonly templateVersionFrozen: true }
export interface CurriculumConfirmationRecord { planKey: string; projectId: string; idempotencyKey: string; templateVersion: string; confirmedAt: string }
export interface CurriculumConfirmationInput {
  plan: CurriculumPlanDraft;
  projectId: string;
  confirmedAt: string | Date;
  idempotencyKey: string;
  existing?: CurriculumConfirmationRecord | null;
  expectedTemplateVersion?: string | null;
}
export interface CurriculumConfirmationResult { plan: CurriculumConfirmedPlan; replayed: boolean }
export interface CurriculumPlanOptions { goal?: string | null; seed?: number; now?: string | Date; templateVersion?: string; lessonMinutes?: 60 | 120 }
export interface CurriculumPlanRequest extends CurriculumExploreInput { templateVersion?: string }
export interface CurriculumGenerationResult { exploration: CurriculumExploration; plan: CurriculumPlanDraft }
export interface CurriculumGenerationDeps { now?: () => string | Date; rng?: (seed: number) => () => number }

export function hashCurriculumSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return hash >>> 0;
}
export function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export function deriveCurriculumSeed(input: { interest: string; lessonCount: LessonCount; goal: string; profile?: CurriculumIntakeProfile | null }): number {
  const profile = input.profile;
  return hashCurriculumSeed([
    input.interest,
    String(input.lessonCount),
    input.goal,
    profile?.priorKnowledge ?? '',
    profile?.targetLevel ?? '',
    String(profile?.timeBudgetMinutes ?? ''),
    [...(profile?.preferences ?? [])].join(','),
  ].join('|'));
}

function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function normalizeInterest(value: unknown): string {
  const interest = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (interest.length < MIN_INTEREST_LENGTH || interest.length > MAX_INTEREST_LENGTH) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'interest length is invalid', [{ path: 'interest', message: 'interest length is invalid' }]);
  return interest;
}
function assertLessonCount(value: unknown): asserts value is LessonCount {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < MIN_LESSON_COUNT || value > MAX_LESSON_COUNT) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'lessonCount must be an integer between 1 and 128', [{ path: 'lessonCount', message: 'invalid lessonCount' }]);
}
function normalizeGoal(value: unknown, interest: string, lessonCount: LessonCount): { goal: string; defaulted: boolean } {
  const goal = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (goal.length > MAX_GOAL_LENGTH) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'goal is too long', [{ path: 'goal', message: 'goal is too long' }]);
  return goal.length > 0 ? { goal, defaulted: false } : { goal: `Master ${interest} in ${lessonCount} lessons`, defaulted: true };
}
function normalizeProfile(profile: CurriculumIntakeProfile | null | undefined): { profile: CurriculumNormalizedIntakeProfile; missing: string[] } {
  const missing: string[] = [];
  const degradedFields: string[] = [];
  const priorKnowledge = nonEmpty(profile?.priorKnowledge) ? profile.priorKnowledge.trim() : null;
  const targetLevel = nonEmpty(profile?.targetLevel) ? profile.targetLevel.trim() : null;
  const budget = typeof profile?.timeBudgetMinutes === 'number' && Number.isFinite(profile.timeBudgetMinutes) && profile.timeBudgetMinutes > 0 ? Math.floor(profile.timeBudgetMinutes) : null;
  const preferences = Array.isArray(profile?.preferences) ? profile.preferences.filter(nonEmpty).map((value) => value.trim()).slice(0, 5) : [];
  if (priorKnowledge === null) { missing.push('priorKnowledge'); degradedFields.push('priorKnowledge'); }
  if (targetLevel === null) { missing.push('targetLevel'); degradedFields.push('targetLevel'); }
  if (budget === null) { missing.push('timeBudgetMinutes'); degradedFields.push('timeBudgetMinutes'); }
  if (preferences.length === 0) { missing.push('preferences'); degradedFields.push('preferences'); }
  return { profile: { priorKnowledge: priorKnowledge ?? DEFAULT_PRIOR_KNOWLEDGE, targetLevel: targetLevel ?? DEFAULT_TARGET_LEVEL, timeBudgetMinutes: budget ?? DEFAULT_TIME_BUDGET_MINUTES, preferences, degradedFields }, missing };
}
export function deriveInterestTags(interest: string): string[] { return [...new Set(interest.split(/[\s,，、/]+/).map((part) => part.trim()).filter(Boolean))].slice(0, 5); }
export function buildClarifyingQuestions(interest: string, missing: readonly string[]): string[] {
  const questions: string[] = [];
  if (missing.includes('priorKnowledge')) questions.push(`What do you already know about ${interest}?`);
  if (missing.includes('targetLevel')) questions.push(`What outcome should ${interest} produce?`);
  if (missing.includes('timeBudgetMinutes')) questions.push('How much time can each lesson take?');
  return (questions.length > 0 ? questions : [`What small result would show progress in ${interest}?`]).slice(0, 3);
}
function resolveNow(value: string | Date | undefined, deps?: CurriculumGenerationDeps): string {
  const raw = value ?? deps?.now?.() ?? CURRICULUM_EPOCH;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'now is not a valid date', [{ path: 'now', message: 'invalid date' }]);
  return date.toISOString();
}

export function exploreCurriculumInterest(input: CurriculumExploreInput, deps?: CurriculumGenerationDeps): CurriculumExploration {
  const interest = normalizeInterest(input.interest);
  assertLessonCount(input.lessonCount);
  const lessonMinutes = input.lessonMinutes ?? 60;
  if (lessonMinutes !== 60 && lessonMinutes !== 120) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'lessonMinutes must be 60 or 120', [{ path: 'lessonMinutes', message: 'invalid lessonMinutes' }]);
  const { goal, defaulted } = normalizeGoal(input.goal, interest, input.lessonCount);
  const normalized = normalizeProfile(input.profile);
  const seed = typeof input.seed === 'number' && Number.isFinite(input.seed) ? Math.floor(input.seed) >>> 0 : deriveCurriculumSeed({ interest, lessonCount: input.lessonCount, goal, profile: input.profile });
  return { phase: 'explore', brand: CURRICULUM_EXPLORATION_BRAND, profileVersion: CURRICULUM_PROMPT_VERSIONS.explore, interest, lessonCount: input.lessonCount, lessonMinutes, goal, goalIsDefaulted: defaulted, profile: normalized.profile, interestTags: deriveInterestTags(interest), clarifyingQuestions: buildClarifyingQuestions(interest, normalized.missing), missingIntakeFields: normalized.missing, exploredAt: resolveNow(input.now, deps), seed };
}

export interface BlockShape { review: number; theory: number; check: number; practice: number; reflect: number }
export function sessionBlockShapeFor(sessionMinutes: number, ordinal: number): BlockShape {
  if (!Number.isSafeInteger(sessionMinutes) || sessionMinutes < 25) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'sessionMinutes is too small', [{ path: 'sessionMinutes', message: 'sessionMinutes must be at least 25' }]);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'ordinal must be non-negative', [{ path: 'ordinal', message: 'invalid ordinal' }]);
  const scale = sessionMinutes / 60;
  const base = ordinal % 2 === 0 ? { review: 5, theory: 25, check: 10, practice: 12, reflect: 8 } : { review: 8, theory: 15, check: 10, practice: 20, reflect: 7 };
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, value * scale])) as unknown as BlockShape;
}
export function blockShapeFor(lessonMinutes: number, lessonIndex: number, firstLesson = false): BlockShape {
  return sessionBlockShapeFor(lessonMinutes, Math.max(0, lessonIndex - 1) + (firstLesson ? 0 : 0));
}
export function themeIndexFor(lessonCount: LessonCount, lessonIndex: number): number { return Math.max(0, Math.min(lessonCount - 1, lessonIndex - 1)); }

function objectiveFor(interest: string, lessonIndex: number, practice: boolean): string {
  return practice ? `Complete and document lesson ${lessonIndex} practice for ${interest}.` : `Explain the key idea of ${interest} in lesson ${lessonIndex}.`;
}
function block(id: string, kind: SessionBlockKind, minutes: number, objectiveIds: string[], prerequisiteObjectiveIds: string[] = []): CurriculumSessionBlock { return { id, kind, minutes, objectiveIds, prerequisiteObjectiveIds }; }

export function planCurriculum(exploration: CurriculumExploration, options: CurriculumPlanOptions = {}): CurriculumPlanDraft {
  if (exploration.phase !== 'explore' || exploration.brand !== CURRICULUM_EXPLORATION_BRAND) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'plan requires a valid exploration snapshot');
  assertLessonCount(exploration.lessonCount);
  const lessonMinutes = options.lessonMinutes ?? exploration.lessonMinutes;
  if (lessonMinutes !== 60 && lessonMinutes !== 120) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'lessonMinutes must be 60 or 120');
  const goal = normalizeGoal(options.goal ?? exploration.goal, exploration.interest, exploration.lessonCount).goal;
  const seed = options.seed === undefined ? exploration.seed : Math.floor(options.seed) >>> 0;
  const modules: CurriculumModule[] = [];
  const objectives: CurriculumObjective[] = [];
  const sessions: CurriculumSession[] = [];
  for (let index = 0; index < exploration.lessonCount; index += 1) {
    const lessonIndex = index + 1;
    const moduleId = `module-lesson-${lessonIndex}`;
    const theoryId = `objective-theory-${lessonIndex}`;
    const practiceId = `objective-practice-${lessonIndex}`;
    const practice = lessonIndex > Math.ceil(exploration.lessonCount / 2);
    modules.push({ id: moduleId, name: `Lesson ${lessonIndex}: ${exploration.interest}`, lessonIndex, objective: objectiveFor(exploration.interest, lessonIndex, practice), ordinal: lessonIndex });
    objectives.push({ id: theoryId, moduleId, name: `Lesson ${lessonIndex} concept`, type: lessonIndex % 2 === 0 ? 'concept' : 'memory', objective: objectiveFor(exploration.interest, lessonIndex, false), prerequisiteIds: [], ordinal: objectives.length + 1 });
    if (practice) objectives.push({ id: practiceId, moduleId, name: `Lesson ${lessonIndex} practice`, type: lessonIndex % 2 === 0 ? 'design' : 'procedure', objective: objectiveFor(exploration.interest, lessonIndex, true), prerequisiteIds: [theoryId], ordinal: objectives.length + 1 });
    const shape = sessionBlockShapeFor(lessonMinutes, index);
    const blocks = practice
      ? [block(`block-${lessonIndex}-review`, 'review', shape.review, [theoryId]), block(`block-${lessonIndex}-theory`, 'theory', shape.theory, [theoryId]), block(`block-${lessonIndex}-check`, 'check', shape.check, [theoryId]), block(`block-${lessonIndex}-practice`, 'practice', shape.practice, [practiceId], [theoryId]), block(`block-${lessonIndex}-reflect`, 'reflect', shape.reflect, [practiceId])]
      : [block(`block-${lessonIndex}-review`, 'review', shape.review, [theoryId]), block(`block-${lessonIndex}-theory`, 'theory', shape.theory + shape.practice, [theoryId]), block(`block-${lessonIndex}-check`, 'check', shape.check, [theoryId]), block(`block-${lessonIndex}-reflect`, 'reflect', shape.reflect, [theoryId])];
    sessions.push({ id: `session-lesson-${lessonIndex}`, moduleId, index, lessonIndex, title: `Lesson ${lessonIndex}: ${exploration.interest}`, mode: 'study', blocks, theoryObjectiveIds: [theoryId], practiceObjectiveIds: practice ? [practiceId] : [] });
  }
  const plan: CurriculumPlanDraft = { phase: 'plan', templateVersion: options.templateVersion ?? CURRICULUM_TEMPLATE_VERSION, lessonCount: exploration.lessonCount, lessonMinutes, minutesPerSession: lessonMinutes, title: `${exploration.interest} lesson plan`, interest: exploration.interest, goal, projectId: null, modules, objectives, sessions, exploration: { phase: 'explore', brand: exploration.brand, profileVersion: exploration.profileVersion, exploredAt: exploration.exploredAt, seed: exploration.seed, interest: exploration.interest, lessonCount: exploration.lessonCount, lessonMinutes: exploration.lessonMinutes, missingIntakeFields: exploration.missingIntakeFields, clarifyingQuestions: exploration.clarifyingQuestions }, generatedAt: resolveNow(options.now), seed };
  assertValidCurriculumPlan(plan);
  return plan;
}
export function generateCurriculumPlan(request: CurriculumPlanRequest, deps?: CurriculumGenerationDeps): CurriculumGenerationResult { const exploration = exploreCurriculumInterest(request, deps); return { exploration, plan: planCurriculum(exploration, request) }; }
export function isTheoryObjective(type: KnowledgeType): boolean { return THEORY_KNOWLEDGE_TYPES.includes(type); }
export function isPracticeObjective(type: KnowledgeType): boolean { return PRACTICE_KNOWLEDGE_TYPES.includes(type); }
export function sessionObjectiveIds(session: CurriculumSession): string[] { return [...new Set([...session.blocks.flatMap((item) => item.objectiveIds), ...session.theoryObjectiveIds, ...session.practiceObjectiveIds])]; }
export function validateObjectiveWording(text: string): CurriculumValidationResult { const errors: CurriculumValidationError[] = []; if (!text.trim() || text.length > MAX_OBJECTIVE_LENGTH) errors.push({ path: 'objective', message: 'objective wording is invalid' }); if (!ABILITY_MARKERS.some((marker) => text.toLowerCase().includes(marker))) errors.push({ path: 'objective', message: 'objective should contain an observable action' }); return { ok: errors.length === 0, errors }; }

function findCycle(objectives: readonly CurriculumObjective[]): string[] | null {
  const byId = new Map(objectives.map((item) => [item.id, item]));
  const state = new Map<string, number>(); const stack: string[] = [];
  const visit = (id: string): string[] | null => { const status = state.get(id) ?? 0; if (status === 1) { const start = stack.indexOf(id); return [...stack.slice(start < 0 ? 0 : start), id]; } if (status === 2) return null; state.set(id, 1); stack.push(id); for (const prerequisite of byId.get(id)?.prerequisiteIds ?? []) { if (byId.has(prerequisite)) { const cycle = visit(prerequisite); if (cycle) return cycle; } } stack.pop(); state.set(id, 2); return null; };
  for (const item of objectives) { const cycle = visit(item.id); if (cycle) return cycle; }
  return null;
}
export function validateCurriculumPlan(plan: CurriculumPlanDraft): CurriculumValidationResult {
  const errors: CurriculumValidationError[] = [];
  if (!plan || typeof plan !== 'object') return { ok: false, errors: [{ path: 'plan', message: 'plan must be an object' }] };
  if (!Number.isSafeInteger(plan.lessonCount) || plan.lessonCount < MIN_LESSON_COUNT || plan.lessonCount > MAX_LESSON_COUNT) errors.push({ path: 'lessonCount', message: 'invalid lessonCount' });
  if (plan.lessonMinutes !== 60 && plan.lessonMinutes !== 120) errors.push({ path: 'lessonMinutes', message: 'invalid lessonMinutes' });
  if (plan.minutesPerSession !== plan.lessonMinutes) errors.push({ path: 'minutesPerSession', message: 'minutesPerSession must equal lessonMinutes' });
  if (plan.modules.length !== plan.lessonCount) errors.push({ path: 'modules', message: 'module count must equal lessonCount' });
  if (plan.sessions.length !== plan.lessonCount) errors.push({ path: 'sessions', message: 'session count must equal lessonCount' });
  const moduleIds = new Set<string>(); const objectiveIds = new Set<string>(); const sessionByObjective = new Map<string, number>();
  for (const module of plan.modules) { if (moduleIds.has(module.id)) errors.push({ path: `modules.${module.id}`, message: 'duplicate module id' }); moduleIds.add(module.id); if (module.lessonIndex < 1 || module.lessonIndex > plan.lessonCount) errors.push({ path: `modules.${module.id}.lessonIndex`, message: 'lessonIndex out of range' }); }
  for (const objective of plan.objectives) { if (objectiveIds.has(objective.id)) errors.push({ path: `objectives.${objective.id}`, message: 'duplicate objective id' }); objectiveIds.add(objective.id); if (!moduleIds.has(objective.moduleId)) errors.push({ path: `objectives.${objective.id}.moduleId`, message: 'unknown module' }); if (!validateObjectiveWording(objective.objective).ok) errors.push({ path: `objectives.${objective.id}.objective`, message: 'objective wording is invalid' }); }
  const cycle = findCycle(plan.objectives); if (cycle) errors.push({ path: 'objectives', message: `prerequisite cycle: ${cycle.join(' -> ')}` });
  for (const [position, session] of plan.sessions.entries()) {
    const path = `sessions.${session.id}`;
    if (session.index !== position) errors.push({ path: `${path}.index`, message: 'index must match order' });
    if (session.lessonIndex !== position + 1) errors.push({ path: `${path}.lessonIndex`, message: 'lessonIndex must be contiguous' });
    const module = plan.modules.find((item) => item.id === session.moduleId); if (!module) errors.push({ path: `${path}.moduleId`, message: 'unknown module' }); else if (module.lessonIndex !== session.lessonIndex) errors.push({ path: `${path}.moduleId`, message: 'module lessonIndex mismatch' });
    const minutes = session.blocks.reduce((sum, item) => sum + item.minutes, 0); if (minutes !== plan.lessonMinutes) errors.push({ path: `${path}.blocks`, message: 'block minutes must equal lessonMinutes' });
    for (const item of session.blocks) { if (item.minutes <= 0) errors.push({ path: `${path}.blocks.${item.id}`, message: 'block minutes must be positive' }); for (const id of [...item.objectiveIds, ...item.prerequisiteObjectiveIds]) if (!objectiveIds.has(id)) errors.push({ path: `${path}.blocks.${item.id}`, message: `unknown objective ${id}` }); }
    for (const id of sessionObjectiveIds(session)) sessionByObjective.set(id, session.index);
  }
  for (const objective of plan.objectives) if (!sessionByObjective.has(objective.id)) errors.push({ path: `objectives.${objective.id}`, message: 'objective is not scheduled' });
  return { ok: errors.length === 0, errors };
}
export function assertValidCurriculumPlan(plan: CurriculumPlanDraft): void { const result = validateCurriculumPlan(plan); if (!result.ok) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', result.errors[0]?.message ?? 'invalid plan', result.errors); }

export interface CurriculumProgressState { masteredObjectiveIds: readonly string[]; pendingQuestionObjectiveId?: string | null; dueReviewObjectiveId?: string | null }
export interface CurriculumNextStep { action: NextAction; sessionId: string | null; sessionIndex: number | null; objectiveId: string | null; knowledgeType: KnowledgeType | null; theoryMastered: boolean; practiceUnlocked: boolean; reason: string }
export function selectNextCurriculumStep(plan: CurriculumPlanDraft, progress: CurriculumProgressState): CurriculumNextStep {
  const mastered = new Set(progress.masteredObjectiveIds);
  const locate = (objectiveId: string) => { const objective = plan.objectives.find((item) => item.id === objectiveId); const session = plan.sessions.find((item) => sessionObjectiveIds(item).includes(objectiveId)); return { objective, session }; };
  if (progress.pendingQuestionObjectiveId) { const found = locate(progress.pendingQuestionObjectiveId); return { action: 'answer_pending', sessionId: found.session?.id ?? null, sessionIndex: found.session?.index ?? null, objectiveId: progress.pendingQuestionObjectiveId, knowledgeType: found.objective?.type ?? null, theoryMastered: false, practiceUnlocked: false, reason: 'answer the pending question' }; }
  if (progress.dueReviewObjectiveId) { const found = locate(progress.dueReviewObjectiveId); return { action: 'review', sessionId: found.session?.id ?? null, sessionIndex: found.session?.index ?? null, objectiveId: progress.dueReviewObjectiveId, knowledgeType: found.objective?.type ?? null, theoryMastered: false, practiceUnlocked: false, reason: 'review evidence is due' }; }
  const session = plan.sessions.find((item) => !sessionObjectiveIds(item).every((id) => mastered.has(id)));
  if (!session) return { action: 'complete', sessionId: null, sessionIndex: null, objectiveId: null, knowledgeType: null, theoryMastered: false, practiceUnlocked: false, reason: 'all lessons are complete' };
  const next = session.theoryObjectiveIds.find((id) => !mastered.has(id)) ?? session.practiceObjectiveIds.find((id) => !mastered.has(id)) ?? null;
  const objective = next ? plan.objectives.find((item) => item.id === next) : undefined;
  const theoryMastered = session.theoryObjectiveIds.every((id) => mastered.has(id));
  return { action: objective && isPracticeObjective(objective.type) ? 'practice' : 'probe', sessionId: session.id, sessionIndex: session.index, objectiveId: next, knowledgeType: objective?.type ?? null, theoryMastered, practiceUnlocked: theoryMastered, reason: theoryMastered ? 'theory is mastered; continue practice' : 'build theory evidence first' };
}
export function curriculumPlanKey(plan: Pick<CurriculumPlanDraft, 'interest' | 'lessonCount' | 'lessonMinutes' | 'templateVersion'>): string { return `${plan.interest}|${plan.lessonCount}|${plan.lessonMinutes}|${plan.templateVersion}`; }
export function assertTemplateVersionFrozen(plan: { templateVersion: string }, expectedTemplateVersion: string): void { if (plan.templateVersion !== expectedTemplateVersion) throw new CurriculumPlanError('LEARNING_PLAN_VERSION_MISMATCH', 'templateVersion drifted', [{ path: 'templateVersion', message: 'templateVersion drifted' }]); }
function isIsoDate(value: string): boolean { return !Number.isNaN(Date.parse(value)); }
export function confirmCurriculumPlan(input: CurriculumConfirmationInput): CurriculumConfirmationResult {
  assertValidCurriculumPlan(input.plan);
  if (!nonEmpty(input.projectId) || !nonEmpty(input.idempotencyKey)) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'projectId and idempotencyKey are required');
  const confirmedAt = input.confirmedAt instanceof Date ? input.confirmedAt.toISOString() : input.confirmedAt;
  if (!isIsoDate(confirmedAt)) throw new CurriculumPlanError('LEARNING_PLAN_INVALID', 'confirmedAt must be an ISO timestamp');
  if (input.expectedTemplateVersion) assertTemplateVersionFrozen(input.plan, input.expectedTemplateVersion);
  const key = curriculumPlanKey(input.plan);
  if (input.existing) {
    if (input.existing.idempotencyKey !== input.idempotencyKey || input.existing.planKey !== key || input.existing.projectId !== input.projectId) throw new CurriculumPlanError('LEARNING_PLAN_TRANSITION_INVALID', 'idempotency key was reused');
    return { plan: { ...input.plan, projectId: input.existing.projectId, confirmedAt: input.existing.confirmedAt, templateVersionFrozen: true }, replayed: true };
  }
  return { plan: { ...input.plan, projectId: input.projectId, confirmedAt, templateVersionFrozen: true }, replayed: false };
}

export interface LearningPlanBlock { id: string; title: string; minutes: number; objectiveIds: readonly string[]; activity: 'explore' | 'learn' | 'practice' | 'reflect' | 'review'; prerequisiteObjectiveIds: readonly string[] }
export interface LearningPlanSession { id: string; lessonIndex: number; title: string; blocks: readonly LearningPlanBlock[] }
export interface LearningPlanDraft { templateVersion: string; lessonCount: LessonCount; lessonMinutes: 60 | 120; title: string; interest: string; sessions: readonly LearningPlanSession[] }
export interface LearningPlanValidationError { path: string; message: string }
export interface LearningPlanValidationResult { ok: boolean; errors: readonly LearningPlanValidationError[] }
function activityForBlockKind(kind: SessionBlockKind): LearningPlanBlock['activity'] { return kind === 'theory' ? 'learn' : kind === 'practice' ? 'practice' : kind === 'review' ? 'review' : 'reflect'; }
export function toLearningPlanDraft(plan: CurriculumPlanDraft): LearningPlanDraft { return { templateVersion: plan.templateVersion, lessonCount: plan.lessonCount, lessonMinutes: plan.lessonMinutes, title: plan.title, interest: plan.interest, sessions: plan.sessions.map((session) => ({ id: session.id, lessonIndex: session.lessonIndex, title: session.title, blocks: session.blocks.map((item) => ({ id: item.id, title: item.kind, minutes: item.minutes, objectiveIds: [...item.objectiveIds], activity: activityForBlockKind(item.kind), prerequisiteObjectiveIds: [...item.prerequisiteObjectiveIds] })) })) }; }
export function validateLearningPlanDraft(draft: LearningPlanDraft): LearningPlanValidationResult {
  const errors: LearningPlanValidationError[] = [];
  if (!Number.isSafeInteger(draft.lessonCount) || draft.lessonCount < MIN_LESSON_COUNT || draft.lessonCount > MAX_LESSON_COUNT) errors.push({ path: 'lessonCount', message: 'invalid lessonCount' });
  if (draft.lessonMinutes !== 60 && draft.lessonMinutes !== 120) errors.push({ path: 'lessonMinutes', message: 'invalid lessonMinutes' });
  if (draft.sessions.length !== draft.lessonCount) errors.push({ path: 'sessions', message: 'session count must equal lessonCount' });
  for (const [index, session] of draft.sessions.entries()) { if (session.lessonIndex !== index + 1) errors.push({ path: `sessions[${index}].lessonIndex`, message: 'lessonIndex must be contiguous' }); if (session.blocks.reduce((sum, item) => sum + item.minutes, 0) !== draft.lessonMinutes) errors.push({ path: `sessions[${index}].blocks`, message: 'blocks must total lessonMinutes' }); }
  return { ok: errors.length === 0, errors };
}
