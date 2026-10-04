import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { sql } from 'drizzle-orm';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { IdempotencyError, throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuditWriter } from '../../common/audit/audit.service';
import type { CurrentUser } from '@qitu/contracts';
import {
  agentMemoryRecords,
  knowledgeChunks,
  knowledgeDocuments,
  outbox,
  projectTemplateVersions,
  projectTemplates,
  type Database,
} from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';

export type InitializationArea = 'knowledge' | 'template' | 'tutor';

export interface InitializationExecutionResult {
  area: InitializationArea;
  status: 'ready';
  completedAt: string;
  replayed: boolean;
}

@Injectable()
export class InitializationService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
  ) {}

  async execute(area: InitializationArea | 'database', actor: CurrentUser, key: string): Promise<InitializationExecutionResult> {
    if (area === 'database') {
      throw new ConflictException({
        code: 'INITIALIZATION_OPERATOR_REQUIRED',
        message: '数据库迁移必须通过部署或 CLI 运维流程执行',
      });
    }
    if (!this.db) {
      throw new ServiceUnavailableException({
        code: 'INITIALIZATION_DATABASE_UNAVAILABLE',
        message: '初始化需要持久化数据库；当前内存模式不可执行',
      });
    }

    await this.assertFoundationSchema(area);
    const scope = `admin:initialization:${area}`;
    const requestHash = hashIdempotentInput(scope, { area }, {});
    try {
      const result = await this.idempotency.execute(scope, key, requestHash, async () => {
        const completedAt = new Date().toISOString();
        await this.db!.transaction(async (tx) => {
          if (area === 'knowledge') await seedKnowledgeFoundation(tx);
          else if (area === 'template') await seedTemplateFoundation(tx);
          else await seedTutorFoundation(tx);
          await this.audit.write({
            actorId: actor.id,
            actorRole: actor.role,
            action: `admin.initialization.${area}.execute`,
            targetType: 'initialization',
            targetId: area,
            idempotencyKey: `${scope}:${key}:${completedAt}`,
            detail: { area, foundationVersion: 'v1', completedAt },
          }, tx);
        });
        return { body: { area, status: 'ready' as const, completedAt } };
      });
      return { ...result.body, replayed: result.replayed };
    } catch (error) {
      if (error instanceof IdempotencyError) throwHttpForIdempotencyError(error);
      throw new ServiceUnavailableException({
        code: 'INITIALIZATION_EXECUTION_FAILED',
        message: '初始化失败；可以使用相同幂等键重试',
      });
    }
  }

  private async assertFoundationSchema(area: InitializationArea): Promise<void> {
    const db = this.db!;
    try {
      await db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({
        code: 'INITIALIZATION_DATABASE_UNAVAILABLE',
        message: '数据库当前不可用；初始化未执行',
      });
    }
    try {
      if (area === 'knowledge') {
        await db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments).limit(0);
        await db.select({ id: knowledgeChunks.id }).from(knowledgeChunks).limit(0);
      } else if (area === 'template') {
        await db.select({ id: projectTemplates.id }).from(projectTemplates).limit(0);
        await db.select({ id: projectTemplateVersions.id }).from(projectTemplateVersions).limit(0);
      } else {
        await db.select({ id: agentMemoryRecords.id }).from(agentMemoryRecords).limit(0);
        await db.select({ id: outbox.id }).from(outbox).limit(0);
      }
    } catch {
      throw new ConflictException({
        code: 'INITIALIZATION_OPERATOR_REQUIRED',
        message: '所需数据库结构尚不可用；请先通过部署或 CLI 完成 schema migration',
      });
    }
  }
}

async function seedKnowledgeFoundation(tx: Parameters<Parameters<Database['transaction']>[0]>[0]): Promise<void> {
  const now = new Date();
  await tx.insert(knowledgeDocuments).values({
    id: 'foundation-knowledge-theory-gate', schoolId: null, scope: 'system', ownerUserId: null, projectId: null,
    title: 'Theory mastery before practice',
    summary: 'Practice tasks require server-confirmed theory mastery.',
    tags: ['TheoryMastered', 'mastery', 'practice'],
    content: 'Practice begins only after the server records TheoryMastered. A single correct answer is not sufficient evidence of mastery.',
    source: 'qitu-platform-foundation', sourceRef: 'policy://theory-before-practice',
    checksum: 'foundation-theory-gate-v1', version: 'v1', status: 'verified', verifiedBy: null, verifiedAt: now,
    createdAt: now, updatedAt: now,
  }).onConflictDoNothing();
  await tx.insert(knowledgeChunks).values({
    id: 'foundation-knowledge-theory-gate-0', documentId: 'foundation-knowledge-theory-gate', ordinal: 0,
    content: 'Practice begins only after the server records TheoryMastered.', tokenCount: 12,
    embedding: null, embeddingModel: null, createdAt: now,
  }).onConflictDoNothing();
}

async function seedTutorFoundation(tx: Parameters<Parameters<Database['transaction']>[0]>[0]): Promise<void> {
  const now = new Date();
  const memoryId = 'foundation-agent-memory-strategy';
  await tx.insert(agentMemoryRecords).values({
    id: memoryId,
    studentId: null,
    partnerId: 'qitu-learning-partner',
    scope: 'agent',
    kind: 'teaching_strategy',
    content: 'Use one observable learning goal and one question at a time.',
    sourceRef: 'policy:foundation-memory-v1',
    sourceEventId: memoryId,
    status: 'active',
    version: 1,
    expiresAt: null,
    indexBackend: null,
    indexId: null,
    indexStatus: 'pending',
    metadata: { foundationVersion: 'v1', approvedBy: 'platform-foundation' },
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  await tx.insert(outbox).values({
    id: `agent-memory-index:${memoryId}:1`,
    topic: 'agent-memory.index',
    payload: { memoryId },
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: now,
    publishedAt: null,
  }).onConflictDoNothing();
}

async function seedTemplateFoundation(tx: Parameters<Parameters<Database['transaction']>[0]>[0]): Promise<void> {
  const now = new Date();
  await tx.insert(projectTemplates).values({
    id: 'foundation-template-project-learning', schoolId: null, slug: 'foundation-project-learning',
    title: 'Project learning foundation',
    summary: 'A reviewable template foundation for exploration, theory, practice, and showcase.',
    domain: 'general', ageRange: null, difficulty: 'beginner', estimatedDurationMinutes: null,
    requiredMaterials: [], learningObjectives: ['Confirm intent before creating a project', 'Master theory before practice'],
    outcomeForm: null, safetyNotes: 'Practice is gated by server-confirmed theory mastery.',
    status: 'draft', createdBy: null, verifiedBy: null, verifiedAt: null, createdAt: now, updatedAt: now,
  }).onConflictDoNothing();
  await tx.insert(projectTemplateVersions).values({
    id: 'foundation-template-project-learning-v1', templateId: 'foundation-template-project-learning', version: 'v1',
    stages: [
      { id: 'exploration', label: 'Exploration' }, { id: 'theory', label: 'Theory' },
      { id: 'practice', label: 'Practice' }, { id: 'showcase', label: 'Showcase' },
    ],
    content: { intentConfirmationRequired: true, theoryMasteryRequiredBeforePractice: true },
    rubric: [], status: 'draft', createdBy: null, publishedAt: null, createdAt: now,
  }).onConflictDoNothing();
}
