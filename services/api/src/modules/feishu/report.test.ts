import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateReportFacts, redactReport, resolveReportScope } from './report';

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


test('resolveReportScope converges teacher scope to active mentor assignments (D1)', () => {
  const students = [{ id: 'student-1' }, { id: 'student-2' }, { id: 'student-3' }];
  const assignments = [{ studentUserId: 'student-1' }, { studentUserId: 'student-2' }];

  const scoped = resolveReportScope('teacher', students, assignments);
  assert.deepEqual(scoped, { status: 'ok', selected: ['student-1', 'student-2'] });

  // 显式名单必须是所带学生子集；越界整体拒绝。
  const subset = resolveReportScope('teacher', students, assignments, ['student-2']);
  assert.deepEqual(subset, { status: 'ok', selected: ['student-2'] });
  assert.deepEqual(
    resolveReportScope('teacher', students, assignments, ['student-3']),
    { status: 'forbidden', reason: 'out-of-scope' },
  );

  // 无班主任分配：fail closed，不产出空范围冒充全量。
  assert.deepEqual(
    resolveReportScope('teacher', students, []),
    { status: 'forbidden', reason: 'no-assignment' },
  );

  // 管理员：全局或显式名单（对象级权限由服务层另行校验）。
  assert.deepEqual(resolveReportScope('admin', students, []), { status: 'ok', selected: ['student-1', 'student-2', 'student-3'] });
  assert.deepEqual(resolveReportScope('admin', students, [], ['student-1']), { status: 'ok', selected: ['student-1'] });
});

test('aggregation surfaces new issue sources without leaking raw content', () => {
  const report = aggregateReportFacts({
    rawIssues: {
      studentIssues: ['共有 3 道学习计划未答题待跟进，是学生端最直接的卡点信号'],
      parentIssues: ['汇报区间内收到 2 条家长咨询/诉求待跟进（公开站咨询通道，仅计数不含联系方式）'],
      teacherIssues: ['当前有 1 项学生成果待班主任复核审批'],
    },
    students: [{ id: 's1', projectCount: 1 }],
  });
  const serialised = JSON.stringify(report);
  assert.ok(report.issueSummary!.formattedText.includes('未答题待跟进'));
  assert.ok(report.issueSummary!.formattedText.includes('家长咨询/诉求待跟进'));
  // 脱敏红线：摘要不携带任何未成年人原文或联系方式字段。
  assert.equal(serialised.includes('conversation'), false);
  assert.equal(serialised.includes('phone'), false);
});
