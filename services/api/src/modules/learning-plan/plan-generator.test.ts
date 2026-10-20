import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DeterministicPlanGenerator,
  PlanGenerationError,
  assertGenerateInput,
  expectedSessionCount,
  findPrerequisiteCycle,
  validateGeneratedPlan,
} from './plan-generator';
import {
  buildPlanOutline,
  generateSessionTeachingPlan,
  persistPlanOutline,
  type PlanOutlineStore,
} from './plan-outline';

function generate(lessonCount: number, lessonMinutes: 60 | 120 = 60) {
  const input = assertGenerateInput({ interest: 'optics', lessonCount, lessonMinutes });
  return new DeterministicPlanGenerator().generate(input);
}

describe('lesson-first plan generator', () => {
  it('creates exactly one module and session per lesson', () => {
    for (const lessonCount of [4, 8, 16]) {
      const plan = generate(lessonCount);
      assert.equal(plan.lessonCount, lessonCount);
      assert.equal(plan.sessionCount, lessonCount);
      assert.equal(plan.modules.length, lessonCount);
      assert.equal(plan.sessions.length, lessonCount);
      assert.deepEqual(plan.sessions.map((session) => session.lessonIndex), Array.from({ length: lessonCount }, (_, i) => i + 1));
      assert.doesNotThrow(() => validateGeneratedPlan(plan));
    }
  });

  it('uses the selected duration for every lesson block', () => {
    for (const minutes of [60, 120] as const) {
      const plan = generate(4, minutes);
      assert.ok(plan.sessions.every((session) => session.blocks.reduce((sum, block) => sum + block.minutes, 0) === minutes));
      assert.doesNotThrow(() => validateGeneratedPlan(plan));
    }
  });

  it('rejects a mismatched sessionCount or invalid lesson duration', () => {
    assert.throws(() => assertGenerateInput({ interest: 'optics', lessonCount: 4, sessionCount: 8 }), PlanGenerationError);
    assert.throws(() => assertGenerateInput({ interest: 'optics', lessonCount: 4, lessonMinutes: 90 }), PlanGenerationError);
  });

  it('does not derive counts from calendar fields', () => {
    assert.equal(expectedSessionCount({ lessonCount: 4 }), 4);
    assert.equal(expectedSessionCount({ lessonCount: 8, sessionCount: 8 }), 8);
    assert.throws(() => assertGenerateInput({ interest: 'optics', lessonCount: 4, calendarSlot: 4 } as never), PlanGenerationError);
  });

  it('reports prerequisite cycles', () => {
    assert.deepEqual(findPrerequisiteCycle([
      { id: 'a', prerequisiteIds: ['b'] },
      { id: 'b', prerequisiteIds: ['a'] },
    ]), ['a', 'b', 'a']);
  });

  it('builds a lesson-indexed outline and teaching plan', () => {
    const plan = { ...generate(4, 120), id: 'plan-1' };
    const outline = buildPlanOutline(plan, new Date('2026-10-20T00:00:00Z'));
    assert.deepEqual(outline.sessions.map((session) => session.lessonIndex), [1, 2, 3, 4]);
    const teaching = generateSessionTeachingPlan(outline, plan, 0, new Date());
    assert.equal(teaching.lessonIndex, 1);
    assert.equal(teaching.minutes, 120);
  });

  it('persists outline objects idempotently through the store contract', async () => {
    const plan = { ...generate(4), id: 'plan-1' };
    const outline = buildPlanOutline(plan, new Date());
    const outlines = new Map<string, typeof outline>();
    const store: PlanOutlineStore = {
      async findOutline(id) { return outlines.get(id) ?? null; },
      async upsertOutline(value) { outlines.set(value.planId, value); return { outline: value, created: true }; },
      async findSessionTeachingPlan() { return null; },
      async upsertSessionTeachingPlan(value) { return { plan: value, created: true }; },
    };
    const first = await persistPlanOutline(store, outline);
    const second = await persistPlanOutline(store, outline);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
  });
});
