import test from 'node:test';
import assert from 'node:assert/strict';
import { loginHref, safeRoleDestination } from '../packages/auth/src/login-routing.ts';
import { schoolDate, projectStageLabel, subjectLabel, studentTemplateSummary } from '../packages/contracts/src/display.ts';
import { currentStudentProject } from '../services/api/src/modules/projects/current-project.ts';
import { scatteringPreview } from '../apps/student-center/features/tutor/lib/opticsPreviewModel.ts';

test('role-scoped return paths reject external, prefix collision, traversal and wrong roles', () => {
  for (const target of ['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/student-other', '/admin/settings', '/student/../admin', '/student/login']) {
    assert.equal(safeRoleDestination(target, 'student'), '/student/today');
  }
  const target = '/student/projects/project-one?mode=learn#task';
  assert.equal(safeRoleDestination(target, 'student'), target);
  const url = new URL(loginHref('student', target, 'expired'), 'https://qitu.invalid');
  assert.equal(url.pathname, '/login');
  assert.equal(url.searchParams.get('next'), target);
  assert.equal(url.searchParams.get('role'), 'student');
});

test('school date crosses midnight in Shanghai independently of host timezone', () => {
  assert.equal(schoolDate(new Date('2026-10-20T15:59:59Z')), '2026-10-20');
  assert.equal(schoolDate(new Date('2026-10-20T16:00:00Z')), '2026-10-21');
  assert.equal(schoolDate(new Date('2026-12-31T20:00:00Z')), '2027-01-01');
});

test('current project is deterministic and excludes completed and exploratory records', () => {
  const project = (id, date, status) => ({ id, createdAt: new Date(date), status });
  const records = [project('old', '2026-10-01', 'practice_building'), project('current', '2026-10-19', 'intent_confirmed'), project('done', '2026-10-20', 'completed'), project('draft', '2026-10-21', 'exploration')];
  assert.equal(currentStudentProject(records)?.id, 'current');
  assert.equal(currentStudentProject([...records].reverse())?.id, 'current');
  assert.equal(currentStudentProject(records.slice(2)), null);
});

test('student labels preserve state semantics without leaking implementation identifiers', () => {
  assert.equal(projectStageLabel('intent_confirmed'), '项目已确认');
  assert.equal(projectStageLabel('unknown'), '状态待确认');
  assert.equal(subjectLabel('physics_optics'), '物理 · 光学');
  assert.equal(subjectLabel('new_internal_domain'), '学科待标注');
  assert.ok(!studentTemplateSummary('检查点不自动产生掌握或作品通过事实。TheoryMastered').includes('TheoryMastered'));
});

test('default scattering presets lie in the approved approximation; out-of-domain produces no ratio', () => {
  for (const wavelength of [450, 680]) assert.equal(scatteringPreview(wavelength, 5).isRayleigh, true);
  assert.equal(scatteringPreview(450, 25).rayleighRatio, null);
});
