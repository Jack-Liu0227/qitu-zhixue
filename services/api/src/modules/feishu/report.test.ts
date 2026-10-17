import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateReportFacts, redactReport } from './report';

test('aggregateReportFacts returns a deterministic, minimum-disclosure projection', () => {
  const report = aggregateReportFacts({
    generatedAt: '2026-10-17T10:00:00.000Z',
    range: { from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' },
    source: ['projects', 'projects', 'guardian_links'],
    students: [
      { id: 'student-raw-1', stage: 'practice', progressPercent: 120, projectCount: 2, stalled: true },
      { id: 'student-raw-2', stage: null, progressPercent: -10, projectCount: -3 },
    ],
    parents: [{ id: 'parent-raw-1', authorizedStudentCount: 1 }],
    teachers: [{ id: 'teacher-raw-1', activeStudentCount: 4, pendingInterventionCount: 2 }],
  });

  assert.deepEqual(report.summary, {
    studentCount: 2,
    parentCount: 1,
    teacherCount: 1,
    projectCount: 2,
    stalledStudentCount: 1,
    pendingInterventionCount: 2,
  });
  assert.deepEqual(report.range, {
    from: '2026-10-16T00:00:00.000Z',
    to: '2026-10-17T00:00:00.000Z',
  });
  assert.deepEqual(report.sources, ['projects', 'guardian_links']);
  assert.equal(report.redacted, true);
  assert.equal(report.generatedAt, '2026-10-17T10:00:00.000Z');
  assert.equal(report.students[0]?.progressPercent, 100);
  assert.equal(report.students[1]?.progressPercent, 0);
  assert.equal(report.students[1]?.projectCount, 0);

  // Raw identifiers must not be sent to Feishu; only stable hashes are present.
  const serialised = JSON.stringify(report);
  assert.equal(serialised.includes('student-raw-1'), false);
  assert.equal(serialised.includes('parent-raw-1'), false);
  assert.equal(serialised.includes('teacher-raw-1'), false);
  assert.match(report.students[0]!.idHash, /^[a-f0-9]{16}$/);

  // Three-party issue summary and formatted message for Feishu bot
  assert.ok(report.issueSummary);
  assert.ok(report.issueSummary.formattedText.includes('三端问题与学情总结'));
  assert.ok(report.issueSummary.studentIssues.length > 0);
  assert.ok(report.issueSummary.parentIssues.length > 0);
  assert.ok(report.issueSummary.teacherIssues.length > 0);
});

test('aggregateReportFacts uses safe defaults for omitted collections and range', () => {
  const before = Date.now();
  const report = aggregateReportFacts({});
  const after = Date.now();

  assert.deepEqual(report.summary, {
    studentCount: 0,
    parentCount: 0,
    teacherCount: 0,
    projectCount: 0,
    stalledStudentCount: 0,
    pendingInterventionCount: 0,
  });
  assert.deepEqual(report.sources, ['projects', 'guardian_links', 'mentor_assignments']);
  assert.equal(report.range.to, report.generatedAt);
  const from = Date.parse(report.range.from);
  const to = Date.parse(report.range.to);
  assert.ok(from >= before - 86_400_000 - 1000 && from <= after - 86_400_000 + 1000);
  assert.ok(to >= before - 1000 && to <= after + 1000);
});

test('redactReport removes sensitive keys recursively without altering safe values', () => {
  const input = {
    summary: { studentCount: 1 },
    messages: [{ rawConversation: 'child text', voiceTranscript: 'child voice' }],
    credentials: { appSecret: 'secret', token: 'token', open_id: 'ou_x' },
    safe: { stage: 'practice', progressPercent: 42 },
  };
  const output = redactReport(input) as Record<string, unknown>;
  assert.deepEqual(output.summary, { studentCount: 1 });
  assert.deepEqual(output.messages, [{}]);
  assert.deepEqual(output.credentials, {});
  assert.deepEqual(output.safe, { stage: 'practice', progressPercent: 42 });
  assert.equal(JSON.stringify(output).includes('child text'), false);
  assert.equal(JSON.stringify(output).includes('secret'), false);
});

test('redactReport handles arrays and leaves the caller-owned object untouched', () => {
  const input = {
    rows: [{ email: 'minor@example.test', count: 2 }, { riskTags: ['internal'], count: 3 }],
  };
  const snapshot = JSON.stringify(input);
  const output = redactReport(input) as { rows: Array<Record<string, unknown>> };
  assert.deepEqual(output.rows, [{ count: 2 }, { count: 3 }]);
  assert.equal(JSON.stringify(input), snapshot);
});

