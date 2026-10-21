import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QITU_SKILL_ROLE_PRESETS } from '@qitu/contracts';
import { loadRuntimeSkillCatalog, loadTutorRuntimeSource } from './runtime-source';

const expectedSkillIds = [
  'pbl-ai-output-audit',
  'pbl-artifact-revision',
  'pbl-cer-coach',
  'pbl-concept-probe',
  'pbl-data-literacy',
  'pbl-defense-coach',
  'pbl-driving-question',
  'pbl-dynamic-lesson',
  'pbl-experiment-design',
  'pbl-hypothesis-coach',
  'pbl-independent-transfer',
  'pbl-peer-critique',
  'pbl-reflection-coach',
  'pbl-source-literacy',
  'pbl-team-facilitation',
  'pbl-understanding-coach',
  'pbl-visual-explainer',
  'optics-wave-inquiry',
  'tutor-guided-learning',
];

test('project teaching Skill catalog discovers every named source package', () => {
  const source = loadTutorRuntimeSource();
  const catalog = loadRuntimeSkillCatalog();
  assert.equal(new Set(catalog.skills.map(skill => skill.id)).size, catalog.skills.length);
  assert.ok(catalog.skills.every(skill => !/-v\d+$/u.test(skill.id)));

  for (const id of expectedSkillIds) assert.ok(source.skills.some(skill => skill.id === id), id);
  for (const preset of Object.values(QITU_SKILL_ROLE_PRESETS)) {
    for (const id of preset.skillIds) assert.ok(source.skills.some(skill => skill.id === id && skill.status === 'ready'), id);
  }
  const dynamic = source.skills.find(skill => skill.id === 'pbl-dynamic-lesson');
  assert.equal(dynamic?.publicationStatus, 'published');
  assert.deepEqual(dynamic?.requiredToolIds, ['tutor.propose_lesson_activity']);
  for (const id of ['pbl-understanding-coach', 'pbl-source-literacy', 'pbl-reflection-coach',
    'pbl-dynamic-lesson', 'pbl-artifact-revision', 'pbl-data-literacy']) {
    const skill = source.skills.find(item => item.id === id);
    assert.ok(skill && skill.publicationStatus === 'published', id);
    assert.ok(skill.content.includes('additional evidence-linked teaching methods'), id);
    assert.ok(skill.content.includes('Qitu teaching contract'), id);
    assert.ok(skill.content.includes('# Method'), id);
  }
  for (const skill of source.skills) {
    assert.equal(skill.status, 'ready', `${skill.id} should have a non-empty teaching body`);
    assert.equal(skill.label, skill.id, `${skill.id} should keep its canonical ID as its declared name`);
    assert.ok(skill.description, `${skill.id} should provide discovery metadata`);
    assert.equal(skill.version, '1.0.0', `${skill.id} should declare its package version`);
    assert.ok(skill.content.length > 0, `${skill.id} should provide coaching instructions`);
  }
});
