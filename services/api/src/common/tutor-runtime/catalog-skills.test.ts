import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTutorRuntimeSource } from './runtime-source';

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

  assert.deepEqual(source.skills.map((skill) => skill.id).sort(), [...expectedSkillIds].sort());
  const dynamic = source.skills.find(skill => skill.id === 'pbl-dynamic-lesson');
  assert.equal(dynamic?.publicationStatus, 'published');
  assert.deepEqual(dynamic?.requiredToolIds, ['tutor.propose_lesson_activity']);
  for (const skill of source.skills) {
    assert.equal(skill.status, 'ready', `${skill.id} should have a non-empty teaching body`);
    assert.equal(skill.label, skill.id, `${skill.id} should keep its canonical ID as its declared name`);
    assert.ok(skill.description, `${skill.id} should provide discovery metadata`);
    assert.equal(skill.version, '1.0.0', `${skill.id} should declare its initial package version`);
    assert.ok(skill.content.length > 0, `${skill.id} should provide coaching instructions`);
  }
});
