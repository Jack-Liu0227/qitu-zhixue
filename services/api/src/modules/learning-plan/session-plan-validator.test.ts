import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DeterministicPlanGenerator,
  PlanGenerationError,
  assertGenerateInput,
} from './plan-generator';
import {
  PLAN_BLOCK_ORDER,
  expectedSessionCount,
  findPrerequisiteCycle,
  validateGeneratedPlan,
} from './session-plan-validator';

function plan(lessonCount = 4, lessonMinutes: 60 | 120 = 60) {
  return new DeterministicPlanGenerator().generate(assertGenerateInput({
    interest: 'optics', lessonCount, lessonMinutes,
  }));
}

describe('lesson-first plan validator', () => {
  it('uses lessonCount as the only session cardinality', () => {
    assert.equal(expectedSessionCount({ lessonCount: 4 }), 4);
    assert.equal(expectedSessionCount({ lessonCount: 16, sessionCount: 16 }), 16);
  });

  it('accepts valid 60 and 120 minute lesson plans', () => {
    for (const minutes of [60, 120] as const) {
      assert.doesNotThrow(() => validateGeneratedPlan(plan(8, minutes)));
    }
  });

  it('rejects an incorrect session count and block total', () => {
    const generated = plan();
    assert.throws(() => validateGeneratedPlan({ ...generated, sessionCount: 8 }), PlanGenerationError);
    const broken = {
      ...generated,
      sessions: generated.sessions.map((session, index) => index === 0
        ? { ...session, blocks: session.blocks.map((block, blockIndex) => blockIndex === 0 ? { ...block, minutes: block.minutes + 1 } : block) }
        : session),
    };
    assert.throws(() => validateGeneratedPlan(broken), PlanGenerationError);
  });

  it('requires ordered lesson indexes and canonical block ordering', () => {
    const generated = plan();
    assert.deepEqual(PLAN_BLOCK_ORDER, ['review', 'theory', 'check', 'practice', 'reflect']);
    const broken = { ...generated, sessions: generated.sessions.map((session, index) => index === 0 ? { ...session, lessonIndex: 2 } : session) };
    assert.throws(() => validateGeneratedPlan(broken), PlanGenerationError);
  });

  it('finds a complete prerequisite cycle', () => {
    assert.deepEqual(findPrerequisiteCycle([
      { id: 'a', prerequisiteIds: ['b'] },
      { id: 'b', prerequisiteIds: ['c'] },
      { id: 'c', prerequisiteIds: ['a'] },
    ]), ['a', 'b', 'c', 'a']);
  });

  it('rejects retired calendar keys at the input boundary', () => {
    assert.throws(() => assertGenerateInput({ interest: 'optics', lessonCount: 4, calendarSlot: 4 } as never), PlanGenerationError);
  });
});
