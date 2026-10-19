import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTutorRuntimeSource } from './runtime-source';

const expectedSkillIds = [
  'pbl-cer-coach',
  'pbl-concept-probe',
  'pbl-data-literacy',
  'pbl-driving-question',
  'pbl-experiment-design',
  'pbl-hypothesis-coach',
  'pbl-reflection-coach',
  'pbl-source-literacy',
  'tutor-guided-learning',
];

test('project teaching Skill catalog contains the baseline and eight named source packages', () => {
  const source = loadTutorRuntimeSource();

  assert.deepEqual(source.skills.map((skill) => skill.id).sort(), expectedSkillIds);
  for (const skill of source.skills) {
    assert.equal(skill.status, 'ready', `${skill.id} should have a non-empty teaching body`);
    assert.equal(skill.label, skill.id, `${skill.id} should keep its canonical ID as its declared name`);
    assert.ok(skill.description, `${skill.id} should provide discovery metadata`);
    assert.equal(skill.version, '1.0.0', `${skill.id} should declare its initial package version`);
    assert.ok(skill.content.length > 0, `${skill.id} should provide coaching instructions`);
  }
});
