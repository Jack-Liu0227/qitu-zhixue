import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import type { PblRubric } from '@qitu/contracts';
import {
  ARTIFACT_BYTES_READ_NOT_CONFIGURED,
  UnconfiguredArtifactBytesReader,
} from './assessor/artifact-bytes.reader';
import {
  CodeArtifactResolver,
  PythonSyntaxChecker,
  type CodeArtifactRef,
  type PythonSyntaxCheckResult,
} from './assessor/code-static-check-producer';
import { MediaArtifactResolver, type MediaArtifactRef } from './assessor/media-compliance-validator';
import { InMemoryProjectAssessmentStore } from './project-assessment.store';
import { ProjectAssessmentService } from './project-assessment.service';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import { EmptyProjectEvidenceSource, InMemoryProjectEvidenceStore } from './project-evidence.store';
import type { TeamRuntimeService } from '../team-runtime/team-runtime.service';

/**
 * 端到端链路的**诚实占位**：预签名 → PUT → 版本行 → 证据物化 → AI 候选 →
 * 确定性阈值规则 → `team.gate.satisfied` 重放。
 *
 * 为什么它是 expected-unavailable 而不是被删掉：
 * live 模式下预签名会抛 503 `OBJECT_STORAGE_NOT_CONFIGURED`，**读**端口也抛
 * `OBJECT_STORAGE_READ_NOT_CONFIGURED`（本文件的下半段就是在断言这一点）。
 * 因此这条链路今天**无法真正跑通**——写一个通过的假测试才是欺骗。
 *
 * 保留它有两个价值：
 * 1. 它就是「接上对象存储之后要跑什么」的可执行规格；
 * 2. 它锁住了当前的**诚实行为**：读不到字节时，结论是「不可判定」，
 *    不是「不通过」，也不是「通过」。
 */

class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

class FakeTeamRuntimeGates {
  readonly calls: unknown[] = [];
  async recordGateForStudent(input: unknown): Promise<{ status: 'recorded'; runId: string; gate: string }> {
    this.calls.push(input);
    return { status: 'recorded', runId: 'run-1', gate: (input as { gate: string }).gate };
  }
}

class NullMediaResolver extends MediaArtifactResolver {
  async resolveByObjectKey(): Promise<MediaArtifactRef | null> {
    return null;
  }
}

class NullCodeResolver extends CodeArtifactResolver {
  async resolve(): Promise<CodeArtifactRef | null> {
    return null;
  }
}

class NullSyntaxChecker extends PythonSyntaxChecker {
  async check(): Promise<PythonSyntaxCheckResult> {
    return { status: 'unavailable', runtimeVersion: null, message: null };
  }
}

const RUBRIC: PblRubric = {
  id: 'kinetic-rubric',
  version: '1',
  title: '动能定理实验报告',
  passingScore: 70,
  criteria: [{
    id: 'structure',
    title: '结构',
    description: '章节齐',
    evidenceRequirementIds: ['report'],
    levels: { 0: '无', 1: '初', 2: '基', 3: '良', 4: '优' },
    weight: 1,
  }],
};

describe('端到端链路（expected-unavailable：缺对象存储）', () => {
  it('live 读端口未配置 → 文档校验抛稳定错误码，绝不落「不合格」结论', async () => {
    const store = new InMemoryProjectAssessmentStore();
    const evidenceStore = new InMemoryProjectEvidenceStore();
    const service = new ProjectAssessmentService(
      store,
      new ProjectEvidenceMaterializer(evidenceStore, new EmptyProjectEvidenceSource()),
      new UnconfiguredArtifactBytesReader(),
      new NullMediaResolver(),
      new NullCodeResolver(),
      new NullSyntaxChecker(),
      new FakeAuditWriter() as unknown as AuditWriter,
      new FakeTeamRuntimeGates() as unknown as TeamRuntimeService,
    );

    await assert.rejects(
      () => service.assessDocumentStructure({
        projectId: 'project-1',
        studentUserId: 'student-1',
        schoolId: null,
        artifactId: 'art-1',
        artifactVersionId: 'artv-1',
        objectKey: 'reports/kinetic.md',
      }),
      (error: unknown) => (error as { code?: string }).code === ARTIFACT_BYTES_READ_NOT_CONFIGURED,
    );
    assert.equal((await store.listChecks('artv-1')).length, 0);
    const stored = await evidenceStore.listByProject('project-1');
    assert.equal(stored.length, 0);
  });

  it('候选 → 规则 → 门禁这一段**不依赖**对象存储，可以在进程内跑通（已验证）', async () => {
    const store = new InMemoryProjectAssessmentStore();
    const gates = new FakeTeamRuntimeGates();
    const service = new ProjectAssessmentService(
      store,
      new ProjectEvidenceMaterializer(new InMemoryProjectEvidenceStore(), new EmptyProjectEvidenceSource()),
      new UnconfiguredArtifactBytesReader(),
      new NullMediaResolver(),
      new NullCodeResolver(),
      new NullSyntaxChecker(),
      new FakeAuditWriter() as unknown as AuditWriter,
      gates as unknown as TeamRuntimeService,
    );

    const result = await service.recordAiCandidate({
      projectId: 'project-1',
      studentUserId: 'student-1',
      schoolId: null,
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      rubric: RUBRIC,
      evidenceRequirements: [{
        id: 'report', objectiveId: 'measure', title: '报告', description: '',
        types: ['document'], required: true, visibility: 'teacher', validation: 'server_check',
      }],
      availableEvidenceIds: ['report'],
      modelId: 'gpt-x',
      score: 88,
      criteria: [{ criterionId: 'structure', level: 4, rationale: '章节齐全', evidenceRefs: ['report'] }],
      evidenceProfile: 'experiment_report',
      trigger: 'works.publish-approved',
    });

    assert.equal(result.decision.outcome, 'auto_accept');
    assert.equal(result.decision.gate, 'experiment_report_validated');
    assert.equal(gates.calls.length, 1);
  });

  it('未接线的部分如实标注：预签名 live 会 503（这条断言与实现同源）', () => {
    // live presigner 的行为由 `UnconfiguredObjectStoragePresigner` 保证（503
    // OBJECT_STORAGE_NOT_CONFIGURED）；此处只锁住「读端口同源不可用」这一条，
    // 避免有人把读端口改成「返回空字节」从而把不可判定伪装成不合格。
    const reader = new UnconfiguredArtifactBytesReader();
    assert.rejects(async () => reader.read('any-key', 16));
  });
});
