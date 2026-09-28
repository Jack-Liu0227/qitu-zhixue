import type { CurrentUser, Role } from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import {
  InMemoryTemplateEvidenceSource,
  InMemoryTemplateViewerDirectory,
} from './template-evidence.store';
import { TemplateGovernanceService } from './templates-governance.service';
import { InMemoryTemplateStore } from './templates.store';
import { TemplatesService } from './templates.service';
import type { TemplateStage, VerificationEvidence } from './templates.types';

/**
 * 模板库测试替身：与真实 `IdempotencyStore` 保持相同的**可观察语义**——
 * 首次执行并记住 `(scope,key)`，同键同载荷重放，同键异载荷冲突。
 */
export class FakeIdempotencyStore {
  private readonly records = new Map<string, { hash: string; body: unknown; status: number }>();
  executions = 0;

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: () => Promise<{ status?: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    const id = `${scope}::${key}`;
    const existing = this.records.get(id);
    if (existing !== undefined) {
      if (existing.hash !== requestHash) {
        throw new IdempotencyError('IDEMPOTENCY_CONFLICT', 'conflict');
      }
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    this.executions += 1;
    const outcome = await handler();
    this.records.set(id, { hash: requestHash, body: outcome.body, status: outcome.status ?? 200 });
    return { status: outcome.status ?? 200, body: outcome.body, replayed: false };
  }
}

export class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];

  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

export function actor(role: Role, id: string): CurrentUser {
  return { id, email: `${id}@example.com`, displayName: id, role };
}

export const DEFAULT_STAGES: TemplateStage[] = [
  { id: 'research', label: '调研' },
  { id: 'build', label: '制作' },
];

/** 满足全部五项验证门槛的证据。 */
export function fullEvidence(templateVersionId: string): VerificationEvidence {
  return {
    templateVersionId,
    completedProjectIds: ['project-1'],
    theoryObjectives: [
      { objectiveId: 'obj-theory-1', knowledgeType: 'concept', mastered: true },
      { objectiveId: 'obj-theory-2', knowledgeType: 'memory', mastered: true },
    ],
    practiceObjectives: [
      { objectiveId: 'obj-practice-1', knowledgeType: 'procedure', mastered: true },
      { objectiveId: 'obj-practice-2', knowledgeType: 'design', mastered: true },
    ],
    artifactAcceptedRefs: ['review-artifact-1'],
    mentorApprovalRefs: ['review-project-1'],
  };
}

export interface ReadHarness {
  service: TemplatesService;
  store: InMemoryTemplateStore;
  directory: InMemoryTemplateViewerDirectory;
}

export function makeReadHarness(): ReadHarness {
  const store = new InMemoryTemplateStore();
  const directory = new InMemoryTemplateViewerDirectory();
  return { service: new TemplatesService(store, directory), store, directory };
}

export interface GovernanceHarness {
  service: TemplateGovernanceService;
  store: InMemoryTemplateStore;
  evidence: InMemoryTemplateEvidenceSource;
  directory: InMemoryTemplateViewerDirectory;
  idempotency: FakeIdempotencyStore;
  audit: FakeAuditWriter;
}

export function makeGovernanceHarness(): GovernanceHarness {
  const store = new InMemoryTemplateStore();
  const evidence = new InMemoryTemplateEvidenceSource();
  const directory = new InMemoryTemplateViewerDirectory();
  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const service = new TemplateGovernanceService(
    store,
    evidence,
    directory,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
  );
  return { service, store, evidence, directory, idempotency, audit };
}

export const VALID_CREATE_INPUT = {
  schoolId: null,
  slug: 'mini-robot',
  title: '迷你机器人',
  summary: '动手搭建一个循迹小车',
  domain: 'engineering',
  ageRange: '10-12',
  difficulty: 'medium',
  estimatedDurationMinutes: 240,
  requiredMaterials: ['主板', '轮子'],
  learningObjectives: ['理解闭环控制', '学会调试传感器'],
  outcomeForm: '可运行作品',
  safetyNotes: '注意用电安全',
};
