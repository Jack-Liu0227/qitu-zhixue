import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyEvidence } from './template-evidence.store';
import { fullEvidence } from './templates.test-support';
import {
  PRACTICE_KNOWLEDGE_TYPES,
  THEORY_KNOWLEDGE_TYPES,
  evaluateTemplateVerification,
} from './template-verification.evaluator';
import type { VerificationEvidence } from './templates.types';

const AT = new Date('2026-03-01T08:00:00.000Z');

function checkKeys(report: ReturnType<typeof evaluateTemplateVerification>): string[] {
  return report.checks.map((check) => check.key);
}

describe('确定性模板验证评测器', () => {
  it('空证据：五项全不通过', () => {
    const report = evaluateTemplateVerification(emptyEvidence('v1'), AT);
    assert.equal(report.passed, false);
    assert.equal(report.checks.length, 5);
    assert.deepEqual(checkKeys(report), [
      'project_completed',
      'theory_mastered',
      'practice_mastered',
      'artifact_accepted',
      'mentor_approved',
    ]);
    assert.ok(report.checks.every((check) => check.passed === false));
    assert.deepEqual(report.evidenceRefs, []);
  });

  it('只有项目完成、没有目标掌握 / 作品 / 复核：仍不通过', () => {
    const evidence: VerificationEvidence = {
      ...emptyEvidence('v1'),
      completedProjectIds: ['project-1'],
    };
    const report = evaluateTemplateVerification(evidence, AT);
    assert.equal(report.passed, false);
    const byKey = new Map(report.checks.map((check) => [check.key, check.passed]));
    assert.equal(byKey.get('project_completed'), true);
    // total >= 1 是硬性要求，空目标集不得视为「全部掌握」。
    assert.equal(byKey.get('theory_mastered'), false);
    assert.equal(byKey.get('practice_mastered'), false);
    assert.equal(byKey.get('artifact_accepted'), false);
    assert.equal(byKey.get('mentor_approved'), false);
  });

  it('任一理论目标未掌握即整体不通过（全量掌握语义）', () => {
    const evidence = fullEvidence('v1');
    evidence.theoryObjectives = [
      { objectiveId: 't1', knowledgeType: 'concept', mastered: true },
      { objectiveId: 't2', knowledgeType: 'memory', mastered: false },
    ];
    const report = evaluateTemplateVerification(evidence, AT);
    assert.equal(report.passed, false);
    const theory = report.checks.find((check) => check.key === 'theory_mastered');
    assert.equal(theory?.passed, false);
    assert.match(theory?.detail ?? '', /1\/2/);
  });

  it('项目完成 + 理论掌握 + 实践掌握 + 作品通过 + 班主任复核 全部满足才通过', () => {
    const report = evaluateTemplateVerification(fullEvidence('v1'), AT);
    assert.equal(report.passed, true);
    assert.ok(report.checks.every((check) => check.passed));
    assert.ok(report.evidenceRefs.some((ref) => ref.startsWith('project:')));
    assert.ok(report.evidenceRefs.some((ref) => ref.startsWith('artifact:')));
    assert.ok(report.evidenceRefs.some((ref) => ref.startsWith('mentor-review:')));
  });

  it('同输入同输出：可重放', () => {
    const evidence = fullEvidence('v1');
    const a = evaluateTemplateVerification(evidence, AT);
    const b = evaluateTemplateVerification(evidence, AT);
    assert.deepEqual(a, b);
    assert.equal(a.evaluatedAt, AT.toISOString());
  });

  it('知识类型归类与领域一致', () => {
    assert.deepEqual([...THEORY_KNOWLEDGE_TYPES], ['memory', 'concept']);
    assert.deepEqual([...PRACTICE_KNOWLEDGE_TYPES], ['procedure', 'design']);
  });
});
