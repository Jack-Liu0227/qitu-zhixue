import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import type { PblRubric, ProjectReviewCandidate } from '@qitu/contracts';
import { InMemoryArtifactBytesReader } from './assessor/artifact-bytes.reader';
import {
  CodeArtifactResolver,
  PythonSyntaxChecker,
  type CodeArtifactRef,
  type PythonSyntaxCheckResult,
} from './assessor/code-static-check-producer';
import {
  MediaArtifactResolver,
  type MediaArtifactRef,
} from './assessor/media-compliance-validator';
import { InMemoryProjectAssessmentStore } from './project-assessment.store';
import { ProjectAssessmentService } from './project-assessment.service';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import {
  EmptyProjectEvidenceSource,
  InMemoryProjectEvidenceStore,
} from './project-evidence.store';
import type { TeamRuntimeService } from '../team-runtime/team-runtime.service';

/* ------------------------------------------------------------------ *
 * 测试替身
 * ------------------------------------------------------------------ */

class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

class FakeTeamRuntimeGates {
  readonly calls: Array<{ studentUserId: string; gate: string; evidenceRef: string; source: string }> = [];
  status: 'recorded' | 'already_satisfied' | 'deferred' = 'recorded';

  async recordGateForStudent(input: {
    studentUserId: string;
    gate: string;
    evidenceRef: string;
    source: string;
  }): Promise<{ status: 'recorded' | 'already_satisfied' | 'deferred'; runId: string | null; gate: string }> {
    this.calls.push(input);
    return { status: this.status, runId: this.status === 'deferred' ? null : 'run-1', gate: input.gate };
  }
}

class FakeMediaResolver extends MediaArtifactResolver {
  ref: MediaArtifactRef | null = null;
  async resolveByObjectKey(): Promise<MediaArtifactRef | null> {
    return this.ref;
  }
}

class FakeCodeResolver extends CodeArtifactResolver {
  ref: CodeArtifactRef | null = null;
  async resolve(): Promise<CodeArtifactRef | null> {
    return this.ref;
  }
}

class FakeSyntaxChecker extends PythonSyntaxChecker {
  result: PythonSyntaxCheckResult = { status: 'ok', runtimeVersion: '3.12.4', message: null };
  async check(): Promise<PythonSyntaxCheckResult> {
    return this.result;
  }
}

const RUBRIC: PblRubric = {
  id: 'kinetic-rubric',
  version: '1',
  title: '动能定理实验报告',
  passingScore: 70,
  criteria: [{ id: 'structure', title: '结构', description: '章节齐', evidenceRequirementIds: ['report'], levels: { 0: '无', 1: '初', 2: '基', 3: '良', 4: '优' }, weight: 1 }],
};

const REPORT = `# 实验报告标题

## 实验目的

验证动能定理。

## 原理公式

W = ΔEk

## 数据表格

| 质量 | 倾角 | 初速 | 末速 | W | ΔEk |
| --- | --- | --- | --- | --- | --- |
| 0.5 | 15 | 0.42 | 1.11 | 0.267 | 0.265 |
| 1.0 | 15 | 0.40 | 1.53 | 0.979 | 0.971 |

## 图表

![chart](./c.png)

## 误差分析

0.75%。

## 结论

一致。
`;

function makeHarness(): {
  service: ProjectAssessmentService;
  store: InMemoryProjectAssessmentStore;
  audit: FakeAuditWriter;
  gates: FakeTeamRuntimeGates;
  reader: InMemoryArtifactBytesReader;
  mediaResolver: FakeMediaResolver;
  codeResolver: FakeCodeResolver;
  evidenceStore: InMemoryProjectEvidenceStore;
} {
  const store = new InMemoryProjectAssessmentStore();
  const audit = new FakeAuditWriter();
  const gates = new FakeTeamRuntimeGates();
  const reader = new InMemoryArtifactBytesReader();
  const mediaResolver = new FakeMediaResolver();
  const codeResolver = new FakeCodeResolver();
  const evidenceStore = new InMemoryProjectEvidenceStore();
  const evidence = new ProjectEvidenceMaterializer(evidenceStore, new EmptyProjectEvidenceSource());
  const service = new ProjectAssessmentService(
    store,
    evidence,
    reader,
    mediaResolver,
    codeResolver,
    new FakeSyntaxChecker(),
    audit as unknown as AuditWriter,
    gates as unknown as TeamRuntimeService,
  );
  return { service, store, audit, gates, reader, mediaResolver, codeResolver, evidenceStore };
}

describe('ProjectAssessmentService（自动评估编排）', () => {
  it('文档结构校验：结论落库 + 证据只带引用与摘要（正文不外泄）', async () => {
    const h = makeHarness();
    h.reader.seed('reports/kinetic.md', REPORT, 'text/markdown');
    const result = await h.service.assessDocumentStructure({
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      objectKey: 'reports/kinetic.md',
      versionTitle: '动能定理实验报告',
    });
    assert.ok(result !== null);
    assert.equal(result.verdict, 'passed');
    assert.equal(result.missing.length, 0);
    assert.equal(result.inserted, true);
    assert.equal(result.evidenceInserted, 1);

    const checks = await h.store.listChecks('artv-1', 'document_structure');
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.verdict, 'passed');
    assert.equal(checks[0]?.sha256, result.sha256);
    assert.equal(checks[0]?.validatorVersion, 'doc-structure-v1');

    // 证据行：label 里只有校验器版本与摘要前缀，正文（0.267 等数值）不出现。
    const facts = await h.evidenceStore.listByProject('project-1');
    assert.equal(facts.length, 1);
    const label = facts[0]!.label;
    assert.ok(label.includes('doc-structure-v1'));
    assert.ok(label.includes(result.sha256.slice(0, 12)));
    assert.equal(label.includes('0.267'), false);
  });

  it('文档结构校验幂等：同一份字节重复校验只留一行结论、一行证据', async () => {
    const h = makeHarness();
    h.reader.seed('reports/kinetic.md', REPORT);
    const input = {
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      objectKey: 'reports/kinetic.md',
    } as const;
    const first = await h.service.assessDocumentStructure({ ...input });
    const second = await h.service.assessDocumentStructure({ ...input });
    assert.equal(first?.inserted, true);
    assert.equal(second?.inserted, false);
    assert.equal((await h.store.listChecks('artv-1')).length, 1);
    assert.equal((await h.evidenceStore.listByProject('project-1')).length, 1);
  });

  it('读不到对象 → 返回 null（不落「校验不通过」的假结论）', async () => {
    const h = makeHarness();
    const result = await h.service.assessDocumentStructure({
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      objectKey: 'reports/missing.md',
    });
    assert.equal(result, null);
    assert.equal((await h.store.listChecks('artv-1')).length, 0);
  });

  it('视频合规：引用不存在 → 抛错且不留痕', async () => {
    const h = makeHarness();
    h.mediaResolver.ref = null;
    await assert.rejects(() => h.service.assessMediaCompliance({
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      objectKey: 'evidence/demo.mp4',
      note: '演示步骤一二三四五六七八九十十一十二十三十四十五',
    }));
    assert.equal((await h.store.listChecks('artv-1')).length, 0);
  });

  it('代码静态检查：只说「语法/结构」，绝不写门禁', async () => {
    const h = makeHarness();
    h.codeResolver.ref = {
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      studentId: 'student-1',
      files: [{ filename: 'main.py', objectKey: 'code/main.py' }],
    };
    h.reader.seed('code/main.py', 'import pygame\n');
    const result = await h.service.assessCodeStatic({
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      artifactVersionId: 'artv-1',
      entryFile: 'main.py',
    });
    assert.equal(result.verdict, 'syntax_ok');
    assert.equal(result.semanticScope, 'static_only');
    const checks = await h.store.listChecks('artv-1', 'code_static');
    assert.equal(checks.length, 1);
    assert.ok(checks[0]!.notes.some((note) => note.includes('不等于可运行')));
    // 门禁一次都没写：静态检查没有门禁写入路径。
    assert.deepEqual(h.gates.calls, []);
  });

  it('AI 候选：分数不足 → 只落候选与审计，不写门禁', async () => {
    const h = makeHarness();
    const result = await h.service.recordAiCandidate({
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      rubric: RUBRIC,
      evidenceRequirements: [{ id: 'report', objectiveId: 'measure', title: '报告', description: '', types: ['document'], required: true, visibility: 'teacher', validation: 'server_check' }],
      availableEvidenceIds: ['report'],
      modelId: 'gpt-x',
      score: 50,
      criteria: [{ criterionId: 'structure', level: 2, rationale: '结构不全', evidenceRefs: ['report'] }],
      evidenceProfile: 'experiment_report',
      trigger: 'works.publish-approved',
    });
    assert.equal(result.inserted, true);
    assert.equal(result.decision.outcome, 'reject');
    assert.equal(result.gateWrite.written, false);
    assert.deepEqual(h.gates.calls, []);
    // 审计：候选留痕一行，但没有「自动验收」行（没通过就不该有验收记录）。
    assert.ok(h.audit.entries.some((entry) => entry.action === 'artifact.review_candidate_recorded'));
    assert.equal(h.audit.entries.some((entry) => entry.action === 'artifact.automatic_acceptance'), false);
  });

  it('AI 候选：达标 → 自动验收审计行 + 门禁写入（一次）', async () => {
    const h = makeHarness();
    const criteria: ProjectReviewCandidate['criteria'] = [
      { criterionId: 'structure', level: 4, rationale: '章节齐全', evidenceRefs: ['report'] },
    ];
    const result = await h.service.recordAiCandidate({
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      rubric: RUBRIC,
      evidenceRequirements: [{ id: 'report', objectiveId: 'measure', title: '报告', description: '', types: ['document'], required: true, visibility: 'teacher', validation: 'server_check' }],
      availableEvidenceIds: ['report'],
      modelId: 'gpt-x',
      score: 90,
      criteria,
      evidenceProfile: 'experiment_report',
      trigger: 'works.publish-approved',
    });
    assert.equal(result.decision.outcome, 'auto_accept');
    assert.equal(result.decision.gate, 'experiment_report_validated');
    assert.equal(result.gateWrite.written, true);
    assert.equal(h.gates.calls.length, 1);
    assert.equal(h.gates.calls[0]?.gate, 'experiment_report_validated');
    assert.equal(h.gates.calls[0]?.source, 'works.publish-approved');

    const acceptance = h.audit.entries.find((entry) => entry.action === 'artifact.automatic_acceptance');
    assert.ok(acceptance !== undefined);
    assert.equal(acceptance.actorId, 'system:pbl-assessor');
    assert.equal((acceptance.detail as { rule?: string }).rule, 'automatic-acceptance:v1');

    const stored = await h.store.findCandidateByKey(result.candidateKey);
    assert.equal(stored?.state, 'accepted');
    assert.equal(stored?.candidate.source, 'ai');
    assert.equal(stored?.acceptedByRule, 'automatic-acceptance:v1');
  });

  it('AI 候选重放：同一键不重写、不重写门禁', async () => {
    const h = makeHarness();
    const base = {
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      rubric: RUBRIC,
      evidenceRequirements: [{ id: 'report', objectiveId: 'measure', title: '报告', description: '', types: ['document'] as const, required: true, visibility: 'teacher' as const, validation: 'server_check' as const }],
      availableEvidenceIds: ['report'],
      modelId: 'gpt-x',
      score: 90,
      criteria: [{ criterionId: 'structure', level: 4 as const, rationale: 'ok', evidenceRefs: ['report'] }],
      evidenceProfile: 'experiment_report' as const,
      trigger: 'works.publish-approved',
    };
    const first = await h.service.recordAiCandidate({ ...base });
    const second = await h.service.recordAiCandidate({ ...base });
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(second.gateWrite.reason, 'candidate_already_recorded');
    assert.equal(h.gates.calls.length, 1);
    assert.equal((await h.store.listCandidates('project-1')).length, 1);
  });

  it('门禁 deferred（学生还没有活跃 run）算调用成功，且如实记录', async () => {
    const h = makeHarness();
    h.gates.status = 'deferred';
    const result = await h.service.recordAiCandidate({
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      rubric: RUBRIC,
      evidenceRequirements: [{ id: 'report', objectiveId: 'measure', title: '报告', description: '', types: ['document'], required: true, visibility: 'teacher', validation: 'server_check' }],
      availableEvidenceIds: ['report'],
      modelId: 'gpt-x',
      score: 90,
      criteria: [{ criterionId: 'structure', level: 4, rationale: 'ok', evidenceRefs: ['report'] }],
      evidenceProfile: 'experiment_report',
      trigger: 'works.publish-approved',
    });
    assert.equal(result.gateWrite.written, true);
    assert.equal(result.gateWrite.writeStatus, 'deferred');
  });
});
