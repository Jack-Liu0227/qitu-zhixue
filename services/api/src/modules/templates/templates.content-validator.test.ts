import assert from 'node:assert/strict';
import { it } from 'node:test';
import { OPTICS_16_SESSION_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { assertTemplateTeachingContent } from './templates.content-validator';

const STAGES = ['exploration', 'concept_mastery', 'guided_practice', 'deliverable_review'].map((id) => ({ id, label: id }));

it('validates teaching source at version creation while retaining generic legacy content', () => {
  assert.doesNotThrow(() => assertTemplateTeachingContent({ pbl: OPTICS_16_SESSION_TEMPLATE_SPEC }, STAGES));
  assert.doesNotThrow(() => assertTemplateTeachingContent({ materials: ['paper'] }, [{ id: 'start', label: 'Start' }]));
  assert.throws(() => assertTemplateTeachingContent({ pbl: null }, STAGES));
  assert.throws(() => assertTemplateTeachingContent({ pbl: OPTICS_16_SESSION_TEMPLATE_SPEC }, [...STAGES].reverse()));
  assert.throws(() => assertTemplateTeachingContent({ curriculum: { totalSessions: 16 } }, STAGES));
  assert.throws(() => assertTemplateTeachingContent({ pbl: OPTICS_16_SESSION_TEMPLATE_SPEC, curriculum: { totalSessions: 16 } }, STAGES));
  assert.throws(() => assertTemplateTeachingContent({ pbl: OPTICS_16_SESSION_TEMPLATE_SPEC, theme: { title: 'parallel' } }, STAGES));
  assert.throws(() => assertTemplateTeachingContent({ pbl: { ...OPTICS_16_SESSION_TEMPLATE_SPEC, secret: 'synthetic' } }, STAGES));
});
