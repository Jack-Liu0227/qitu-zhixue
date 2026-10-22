import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WAVE_OPTICS_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { parseProjectTemplateSpec } from '@qitu/contracts';
import { makeGovernanceHarness, actor, VALID_CREATE_INPUT, DEFAULT_STAGES } from './templates.test-support';

test('editing an eight-lesson course creates a separate idempotent draft and readbacks its actual content', async () => {
  const h = makeGovernanceHarness(); const admin = actor('admin', 'course-author');
  const created = await h.service.createTemplate(admin, { ...VALID_CREATE_INPUT, slug: 'wave-authoring-fixture' }, 'template');
  const first = await h.service.createVersion(admin, created.template.id,
    { stages: DEFAULT_STAGES, content: { pbl: WAVE_OPTICS_TEMPLATE_SPEC }, rubric: [] }, 'original');
  await h.service.pilotVersion(admin, created.template.id, first.version.id, 'pilot', 'Synthetic authoring fixture');
  const edited = structuredClone(WAVE_OPTICS_TEMPLATE_SPEC);
  edited.version = 'v1-8s-guided.edit-fixture';
  const lesson = edited.curriculum!.profiles[0]!.sessions[0]!;
  lesson.leadAssistantId = 'optics-concept-coach';
  lesson.opening = { ...lesson.opening!, prompt: 'Which observation would you record first?' };
  const input = { stages: DEFAULT_STAGES, content: { pbl: edited }, rubric: [] };
  const saved = await h.service.createVersion(admin, created.template.id, input, 'edited');
  const replay = await h.service.createVersion(admin, created.template.id, input, 'edited');
  assert.equal(replay.version.id, saved.version.id); assert.equal(replay.replayed, true);
  const versions = await h.service.listGovernedVersions(admin, created.template.id);
  assert.equal(versions.length, 2);
  const fresh = parseProjectTemplateSpec(versions.find(version => version.id === saved.version.id)!.content.pbl);
  assert.equal(fresh.curriculum!.profiles[0]!.sessions[0]!.leadAssistantId, lesson.leadAssistantId);
  assert.equal(fresh.curriculum!.profiles[0]!.sessions[0]!.opening!.prompt, lesson.opening.prompt);
  const original = versions.find(version => version.id === first.version.id)!;
  assert.equal(original.status, 'piloting');
  assert.deepEqual(original.content.pbl, WAVE_OPTICS_TEMPLATE_SPEC);
  assert.equal(saved.version.status, 'draft');
  await assert.rejects(h.service.createVersion(actor('student', 'other'), created.template.id, input, 'unauthorized'));
  const verification = await h.service.verifyVersion(admin, created.template.id, saved.version.id, 'verify');
  assert.equal(verification.report.passed, false);
  await assert.rejects(h.service.publishVersion(admin, created.template.id, saved.version.id, 'publish', 'No real pilot evidence'));
});
