import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertAssistantSkillBudget } from './assistant-skill-budget';

test('assistant configuration rejects an oversized skill bundle with an actionable 400 response', () => {
  assert.doesNotThrow(() => assertAssistantSkillBudget([{ content: 'a'.repeat(12_000) }, { content: 'b'.repeat(12_000) }]));
  assert.throws(() => assertAssistantSkillBudget([{ content: 'a'.repeat(12_000) }, { content: 'b'.repeat(12_001) }]),
    (error: unknown) => error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function'
      && error.getStatus() === 400 && 'getResponse' in error && typeof error.getResponse === 'function'
      && error.getResponse().code === 'ASSISTANT_SKILL_BUDGET_EXCEEDED');
});
