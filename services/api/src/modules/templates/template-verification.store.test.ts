import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VerificationEvidence, VerificationReport } from './templates.types';
import { fullEvidence } from './templates.test-support';
import {
  InMemoryTemplateVerificationStore,
  buildVerificationEvidenceRows,
  verificationEvidenceRowId,
  type RecordVerificationRunInput,
} from './template-verification.store';
import {
  toVerificationEvidenceInsert,
  toVerificationEvidenceRecord,
  toVerificationRunInsert,
  toVerificationRunRecord,
} from './template-verification.store.postgres';

const VERSION_ID = 'tplv-verify-1';

function reportFor(evidence: VerificationEvidence, passed: boolean): VerificationReport {
  return {
    templateVersionId: evidence.templateVersionId,
    passed,
    checks: [
      { key: 'project_completed', label: '项目完成', passed, detail: '已完成项目 1 个' },
    ],
    evidenceRefs: [`project:${evidence.completedProjectIds[0] ?? 'none'}`],
    evaluatedAt: '2026-09-28T10:00:00.000Z',
  };
}

function recordInput(
  idempotencyKey: string,
  passed = true,
): RecordVerificationRunInput {
  const evidence = fullEvidence(VERSION_ID);
  return {
    id: 'tvrun-1',
    schoolId: 'school-a',
    templateVersionId: VERSION_ID,
    report: reportFor(evidence, passed),
    evidence,
    evaluatedBy: 'admin-1',
    idempotencyKey,
    evaluatedAt: new Date('2026-09-28T10:00:00.000Z'),
  };
}

describe('模板验证 run / 证据持久化边界（迁移 0009）', () => {
  it('证据行按检查项分类，id 稳定可重放', () => {
    const rows = buildVerificationEvidenceRows(recordInput('k-1'));
    // 1 项目 + 2 理论 + 2 实践 + 1 作品 + 1 复核 = 7
    assert.equal(rows.length, 7);
    assert.deepEqual(
      rows.map((row) => [row.checkKey, row.sourceKind]),
      [
        ['project_completed', 'project'],
        ['theory_mastered', 'objective'],
        ['theory_mastered', 'objective'],
        ['practice_mastered', 'objective'],
        ['practice_mastered', 'objective'],
        ['artifact_accepted', 'artifact'],
        ['mentor_approved', 'mentor_review'],
      ],
    );
    assert.equal(rows[0]!.id, verificationEvidenceRowId('tvrun-1', 'project_completed', 'project', 'project-1'));
    assert.equal(rows[0]!.runId, 'tvrun-1');
    assert.equal(rows[0]!.schoolId, 'school-a');
    // 不复制未成年人正文。
    assert.equal(rows[0]!.detail, null);
    assert.equal(rows[0]!.studentUserId, null);
  });

  it('run 插入行携带确定性报告；证据行 ↔ 领域投影可逆', () => {
    const input = recordInput('k-1');
    const insert = toVerificationRunInsert(input);
    assert.equal(insert.passed, true);
    assert.equal(insert.evidenceCount, 1);
    assert.equal(insert.idempotencyKey, 'k-1');
    assert.equal(insert.evaluatedAt.toISOString(), '2026-09-28T10:00:00.000Z');
    assert.deepEqual(insert.checks, input.report.checks);
    assert.deepEqual(insert.evidenceRefs, input.report.evidenceRefs);

    const evidenceRows = buildVerificationEvidenceRows(input);
    const inserts = evidenceRows.map(toVerificationEvidenceInsert);
    const projectedEvidence = inserts.map((row) => toVerificationEvidenceRecord(row as never));
    assert.deepEqual(projectedEvidence[0], evidenceRows[0]);

    const row = {
      id: 'tvrun-1',
      schoolId: 'school-a',
      templateVersionId: VERSION_ID,
      passed: true,
      checks: input.report.checks,
      evidenceRefs: input.report.evidenceRefs,
      evidenceCount: 1,
      evaluatedBy: 'admin-1',
      idempotencyKey: 'k-1',
      evaluatedAt: input.evaluatedAt,
      createdAt: input.evaluatedAt,
    };
    const projected = toVerificationRunRecord(row as never, projectedEvidence as never);
    assert.equal(projected.report.evaluatedAt, '2026-09-28T10:00:00.000Z');
    assert.deepEqual(projected.report.evidenceRefs, input.report.evidenceRefs);
    assert.equal(projected.evidence.length, 7);
    assert.equal(projected.passed, true);
  });

  it('内存实现：同键重放不落第二条，证据不重复', async () => {
    const store = new InMemoryTemplateVerificationStore();
    const first = await store.record(recordInput('k-dupe'));
    assert.equal(first.replayed, false);
    assert.equal(first.run.evidenceCount, 1);
    assert.equal(first.run.evidence.length, 7);

    const replay = await store.record(recordInput('k-dupe'));
    assert.equal(replay.replayed, true);
    assert.equal(replay.run.id, first.run.id);
    assert.deepEqual(replay.run.report, first.run.report);

    const byVersion = await store.listByVersion(VERSION_ID);
    assert.equal(byVersion.length, 1);
    assert.equal(byVersion[0]!.evidence.length, 7);
  });

  it('内存实现：失败报告同样只追加，可回读用于审计', async () => {
    const store = new InMemoryTemplateVerificationStore();
    const recorded = await store.record(recordInput('k-fail', false));
    assert.equal(recorded.run.passed, false);
    const found = await store.findByIdempotencyKey('k-fail');
    assert.equal(found?.passed, false);
    assert.equal(await store.findByIdempotencyKey('missing'), null);
  });
});
