import type {
  KnowledgeType,
  LearningPlanBlockActivity,
  SessionBlockKind,
  SessionMode,
} from '@qitu/contracts';
import {
  PlanGenerationError,
  PlanValidationError,
  blockShapesCoverSessionMinutes,
  expectedSessionCount,
  findPrerequisiteCycle,
  validateGeneratedPlan,
  MAX_OBJECTIVES_PER_SESSION,
  PLAN_BLOCK_ORDER,
  type PlanViolation,
  type SessionPlanShape,
} from './session-plan-validator';

export {
  PlanGenerationError,
  PlanValidationError,
  validateGeneratedPlan,
  findPrerequisiteCycle,
  expectedSessionCount,
  blockShapesCoverSessionMinutes,
  MAX_OBJECTIVES_PER_SESSION,
  PLAN_BLOCK_ORDER,
  type PlanViolation,
  type SessionPlanShape,
};

export type PlanSessionCount = number;

export const CURRICULUM_TEMPLATE_VERSION = 'curriculum-plan-v1';
export const MIN_INTEREST_LENGTH = 1;
export const MAX_INTEREST_LENGTH = 60;
export const MAX_GOAL_LENGTH = 200;
export const MINUTES_PER_SESSION = 60;
export const SESSION_COUNT_OPTIONS: readonly PlanSessionCount[] = [4, 8, 16];

export interface GeneratedObjective {
  id: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  objective: string;
  prerequisiteIds: string[];
  ordinal: number;
  conceptId?: string | null;
}

export interface GeneratedModule {
  id: string;
  name: string;
  lessonIndex: number;
  objective: string;
  ordinal: number;
}

export interface GeneratedBlock {
  id: string;
  title: string;
  minutes: number;
  activity: LearningPlanBlockActivity;
  kind: SessionBlockKind;
  guidance?: string;
  evidenceRequirements?: readonly string[];
  objectiveIds: string[];
  prerequisiteObjectiveIds: string[];
}

export interface GeneratedSession {
  id: string;
  moduleId: string;
  index: number;
  lessonIndex: number;
  title: string;
  blocks: GeneratedBlock[];
  theoryObjectiveIds: string[];
  practiceObjectiveIds: string[];
  mode: SessionMode;
}

export interface GeneratedPlan {
  templateVersion: string;
  lessonCount: number;
  lessonMinutes: 60 | 120;
  sessionCount: number;
  minutesPerSession: number;
  title: string;
  interest: string;
  goal: string;
  curriculumSlug?: string;
  modules: GeneratedModule[];
  objectives: GeneratedObjective[];
  sessions: GeneratedSession[];
}

export interface GeneratePlanInput {
  interest: string;
  lessonCount: number;
  lessonMinutes: 60 | 120;
  goal: string | null;
  sessionCount?: number;
  curriculumSlug?: string;
}

export const SERVER_OWNED_FIELDS: readonly string[] = [
  'stage', 'mastery', 'masteryScore', 'masteryBasisPoints', 'qualitativeMastered',
  'theoryMastered', 'practiceUnlocked', 'projectId', 'project', 'status', 'confirmedAt',
  'completedAt', 'version', 'studentUserId', 'templateVersion', 'templateVersionId',
  'objectiveStatus',
];

export const GENERATE_INPUT_FIELDS: readonly string[] = [
  'interest', 'lessonCount', 'lessonMinutes', 'goal', 'sessionCount', 'curriculumSlug',
];

/** Reject fields whose values belong exclusively to server-owned state. */
export function assertNoServerOwnedFields(body: unknown): void {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return;
  const source = body as Record<string, unknown>;
  const offending = SERVER_OWNED_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(source, field));
  if (offending.length > 0) {
    throw new PlanGenerationError(
      `Request contains unsupported fields: ${offending.join(', ')}`,
      offending.map((field) => ({ path: field, message: 'field is not part of the lesson-based contract' })),
    );
  }
}

/** Reject unknown generate-request keys instead of silently projecting retired contracts. */
export function assertGenerateInputFields(body: unknown): void {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return;
  const allowed = new Set(GENERATE_INPUT_FIELDS);
  const unknown = Object.keys(body as Record<string, unknown>).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new PlanGenerationError(
      `Request contains unsupported fields: ${unknown.join(', ')}`,
      unknown.map((field) => ({ path: field, message: 'field is not part of the lesson-based contract' })),
    );
  }
}

export abstract class PlanGenerator {
  abstract generate(input: GeneratePlanInput): GeneratedPlan;
}

/** Deterministic fallback: every module and session is exactly one lesson. */
export class DeterministicPlanGenerator extends PlanGenerator {
  generate(input: GeneratePlanInput): GeneratedPlan {
    const interest = input.interest.trim();
    const lessonCount = input.lessonCount;
    const lessonMinutes = input.lessonMinutes;
    if (!Number.isSafeInteger(lessonCount) || lessonCount < 1 || lessonCount > 128) {
      throw new PlanGenerationError('lessonCount must be an integer between 1 and 128', [
        { path: 'lessonCount', message: 'invalid lessonCount' },
      ]);
    }
    if (lessonMinutes !== 60 && lessonMinutes !== 120) {
      throw new PlanGenerationError('lessonMinutes must be 60 or 120', [
        { path: 'lessonMinutes', message: 'invalid lessonMinutes' },
      ]);
    }
    if (input.sessionCount !== undefined && input.sessionCount !== lessonCount) {
      throw new PlanGenerationError('sessionCount must equal lessonCount', [
        { path: 'sessionCount', message: 'sessionCount must equal lessonCount' },
      ]);
    }

    const title = `${interest} · ${lessonCount} 课时学习计划`;
    const goal = input.goal?.trim() || `用 ${lessonCount} 个课时掌握「${interest}」的核心知识与实践能力`;
    const modules: GeneratedModule[] = [];
    const objectives: GeneratedObjective[] = [];
    const sessions: GeneratedSession[] = [];

    for (let index = 0; index < lessonCount; index += 1) {
      const lessonIndex = index + 1;
      const moduleId = `mod-l${lessonIndex}`;
      modules.push({
        id: moduleId,
        name: `第 ${lessonIndex} 课时 · ${interest}`,
        lessonIndex,
        objective: `完成第 ${lessonIndex} 课时的学习目标与活动`,
        ordinal: lessonIndex,
      });
      const shape = blockShape(lessonMinutes, index);
      const pairIndex = Math.floor(index / 2) + 1;
      const isTheory = index % 2 === 0;
      const previousPracticeId = index >= 2 ? `obj-p-${index - 1}` : null;
      const theoryId = isTheory ? `obj-t-${index}` : `obj-t-${index - 1}`;
      const practiceId = `obj-p-${index}`;

      if (isTheory) {
        objectives.push({
          id: theoryId,
          moduleId,
          name: `${interest} 理论要点 ${pairIndex}`,
          type: pairIndex % 2 === 1 ? 'memory' : 'concept',
          objective: `能解释「${interest}」的第 ${pairIndex} 个理论要点`,
          prerequisiteIds: [],
          ordinal: objectives.length,
        });
      } else {
        objectives.push({
          id: practiceId,
          moduleId,
          name: `${interest} 实践任务 ${pairIndex}`,
          type: pairIndex % 2 === 1 ? 'procedure' : 'design',
          objective: `完成「${interest}」的第 ${pairIndex} 个实践任务并提交证据`,
          prerequisiteIds: [theoryId],
          ordinal: objectives.length,
        });
      }

      const blocks = isTheory
        ? [
          block(index, 'review', shape.review, previousPracticeId === null ? [] : [previousPracticeId]),
          block(index, 'theory', shape.theory + shape.practice, [theoryId]),
          block(index, 'check', shape.check, [theoryId]),
          block(index, 'reflect', shape.reflect, [theoryId]),
        ]
        : [
          block(index, 'review', shape.review, [theoryId]),
          block(index, 'theory', shape.theory, [theoryId]),
          block(index, 'check', shape.check, [theoryId]),
          block(index, 'practice', shape.practice, [practiceId], [theoryId]),
          block(index, 'reflect', shape.reflect, [practiceId]),
        ];

      sessions.push({
        id: `sess-${lessonIndex}`,
        moduleId,
        index,
        lessonIndex,
        title: `${isTheory ? '理论' : '实践'} ${pairIndex} · ${isTheory ? `${interest} 理论要点` : `${interest} 实践任务`}`,
        blocks,
        theoryObjectiveIds: isTheory ? [theoryId] : [theoryId],
        practiceObjectiveIds: isTheory ? [] : [practiceId],
        mode: 'study',
      });
    }

    return {
      templateVersion: CURRICULUM_TEMPLATE_VERSION,
      lessonCount,
      lessonMinutes,
      sessionCount: lessonCount,
      minutesPerSession: lessonMinutes,
      title,
      interest,
      goal,
      ...(input.curriculumSlug === undefined ? {} : { curriculumSlug: input.curriculumSlug }),
      modules,
      objectives,
      sessions,
    };
  }
}

function blockShape(minutes: number, ordinal: number): Record<SessionBlockKind, number> {
  const scale = minutes / 60;
  const base = ordinal % 2 === 0
    ? { review: 5, theory: 25, check: 10, practice: 12, reflect: 8 }
    : { review: 8, theory: 15, check: 10, practice: 20, reflect: 7 };
  return Object.fromEntries(Object.entries(base).map(([kind, value]) => [kind, value * scale])) as Record<SessionBlockKind, number>;
}

function block(
  sessionIndex: number,
  kind: SessionBlockKind,
  minutes: number,
  objectiveIds: string[],
  prerequisiteObjectiveIds: string[] = [],
): GeneratedBlock {
  return {
    id: `blk-${sessionIndex}-${kind}`,
    title: BLOCK_TITLES[kind],
    minutes,
    activity: activityForKind(kind),
    kind,
    objectiveIds,
    prerequisiteObjectiveIds,
  };
}

const BLOCK_TITLES: Readonly<Record<SessionBlockKind, string>> = {
  review: '衔接回顾',
  theory: '理论讲解',
  check: '理解检查',
  practice: '动手实践',
  reflect: '反思复盘',
};

export function activityForKind(kind: SessionBlockKind): LearningPlanBlockActivity {
  switch (kind) {
    case 'review': return 'review';
    case 'theory': return 'learn';
    case 'check': return 'reflect';
    case 'practice': return 'practice';
    case 'reflect': return 'reflect';
  }
}

export function assertGenerateInput(input: {
  interest: unknown;
  lessonCount?: unknown;
  lessonMinutes?: unknown;
  goal?: unknown;
  sessionCount?: unknown;
  curriculumSlug?: unknown;
}): GeneratePlanInput {
  const interest = typeof input.interest === 'string' ? input.interest.trim() : '';
  if (interest.length < MIN_INTEREST_LENGTH || interest.length > MAX_INTEREST_LENGTH) {
    throw new PlanGenerationError(`interest length must be ${MIN_INTEREST_LENGTH}..${MAX_INTEREST_LENGTH}`, [
      { path: 'interest', message: 'invalid length' },
    ]);
  }
  if (typeof input.lessonCount !== 'number' || !Number.isSafeInteger(input.lessonCount)
    || input.lessonCount < 1 || input.lessonCount > 128) {
    throw new PlanGenerationError('lessonCount must be an integer between 1 and 128', [
      { path: 'lessonCount', message: 'invalid lessonCount' },
    ]);
  }
  const lessonMinutes = input.lessonMinutes === undefined ? 60 : input.lessonMinutes;
  if (lessonMinutes !== 60 && lessonMinutes !== 120) {
    throw new PlanGenerationError('lessonMinutes must be 60 or 120', [
      { path: 'lessonMinutes', message: 'invalid lessonMinutes' },
    ]);
  }
  if (input.sessionCount !== undefined && input.sessionCount !== input.lessonCount) {
    throw new PlanGenerationError('sessionCount must equal lessonCount', [
      { path: 'sessionCount', message: 'sessionCount must equal lessonCount' },
    ]);
  }
  let goal: string | null = null;
  if (input.goal !== undefined && input.goal !== null) {
    if (typeof input.goal !== 'string') {
      throw new PlanGenerationError('goal must be a string', [{ path: 'goal', message: 'invalid goal' }]);
    }
    goal = input.goal.trim() || null;
    if (goal !== null && goal.length > MAX_GOAL_LENGTH) {
      throw new PlanGenerationError(`goal cannot exceed ${MAX_GOAL_LENGTH} characters`, [
        { path: 'goal', message: 'goal too long' },
      ]);
    }
  }
  let curriculumSlug: string | undefined;
  if (input.curriculumSlug !== undefined && input.curriculumSlug !== null) {
    if (typeof input.curriculumSlug !== 'string') {
      throw new PlanGenerationError('curriculumSlug must be a string', [
        { path: 'curriculumSlug', message: 'invalid curriculumSlug' },
      ]);
    }
    curriculumSlug = input.curriculumSlug.trim();
    if (curriculumSlug.length === 0 || curriculumSlug.length > 120) {
      throw new PlanGenerationError('curriculumSlug length must be 1..120', [
        { path: 'curriculumSlug', message: 'invalid curriculumSlug length' },
      ]);
    }
  }
  return {
    interest,
    lessonCount: input.lessonCount,
    lessonMinutes,
    goal,
    sessionCount: input.sessionCount as number | undefined,
    curriculumSlug,
  };
}
