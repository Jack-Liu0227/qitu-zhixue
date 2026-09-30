import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { CurrentUser } from '@qitu/contracts';
import type { AgentMemoryRecord, MemoryKind, MemoryView } from '@qitu/agent-memory';
import { validateMemoryText } from '@qitu/agent-memory';
import { agentMemoryRecords, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit';
import { OutboxWriter } from '../../common/outbox';
import { IdempotencyStore, hashRequest } from '../../common/idempotency';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';

export interface MemoryInput {
  partnerId: string;
  content: string;
  kind: MemoryKind;
  sourceRef?: string;
  idempotencyKey: string;
}

@Injectable()
export class AgentMemoryService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly idempotency: IdempotencyStore,
  ) {}

  async listRelationship(actor: CurrentUser, partnerId: string): Promise<MemoryView[]> {
    assertStudent(actor);
    requirePartner(partnerId);
    const rows = await this.requireDb().select().from(agentMemoryRecords).where(and(
      eq(agentMemoryRecords.studentId, actor.id), eq(agentMemoryRecords.partnerId, partnerId),
      eq(agentMemoryRecords.scope, 'relationship'), eq(agentMemoryRecords.status, 'active'),
      or(isNull(agentMemoryRecords.expiresAt), gt(agentMemoryRecords.expiresAt, new Date())),
    )).orderBy(desc(agentMemoryRecords.updatedAt)).limit(100);
    return rows.map(toRecord).map(toView);
  }

  async createRelationship(actor: CurrentUser, input: MemoryInput): Promise<MemoryView> {
    assertStudent(actor);
    if (input.kind === 'teaching_strategy') throw inputError('学生不能发布导师策略');
    return this.create(actor, input, 'relationship');
  }

  async createStrategy(actor: CurrentUser, input: MemoryInput): Promise<MemoryView> {
    if (actor.role !== 'admin') throw new ForbiddenException({ code: 'MEMORY_FORBIDDEN', message: '只有管理员可以发布导师策略记忆' });
    if (input.kind !== 'teaching_strategy' || !input.sourceRef || !/^policy:[a-z0-9._:-]{1,150}$/iu.test(input.sourceRef)) {
      throw inputError('策略需要 policy: 评审来源引用');
    }
    return this.create(actor, input, 'agent');
  }

  async correct(actor: CurrentUser, id: string, content: string, key: string): Promise<MemoryView> {
    assertStudent(actor);
    const text = safeText(content);
    const scope = `agent-memory.correct:${actor.id}:${id}`;
    return this.command(scope, key, { content: text }, async () => {
      return this.requireDb().transaction(async (tx) => {
        const rows = await tx.select().from(agentMemoryRecords).where(and(
          eq(agentMemoryRecords.id, id), eq(agentMemoryRecords.studentId, actor.id), eq(agentMemoryRecords.scope, 'relationship'),
        )).for('update');
        const row = rows[0];
        if (!row || row.status !== 'active') throw notFound();
        const version = row.version + 1;
        const updated = await tx.update(agentMemoryRecords).set({ content: text, version, sourceRef: `student_correction:${digest(scope, key)}`, indexStatus: 'pending', updatedAt: new Date() }).where(eq(agentMemoryRecords.id, id)).returning();
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'agent_memory.correct', targetType: 'agent_memory', targetId: id, idempotencyKey: digest(scope, key), detail: { version } }, tx);
        await this.outbox.write({ id: `agent-memory-index:${id}:${version}`, topic: 'agent-memory.index', payload: { memoryId: id } }, tx);
        return toView(toRecord(updated[0]!));
      });
    });
  }

  async remove(actor: CurrentUser, id: string, key: string): Promise<{ deleted: true }> {
    const scope = `agent-memory.delete:${actor.id}:${id}`;
    return this.command(scope, key, {}, async () => {
      await this.requireDb().transaction(async (tx) => {
        const rows = await tx.select().from(agentMemoryRecords).where(eq(agentMemoryRecords.id, id)).for('update');
        const row = rows[0];
        const allowed = row !== undefined && ((row.scope === 'relationship' && actor.role === 'student' && row.studentId === actor.id) || (row.scope === 'agent' && actor.role === 'admin'));
        if (!allowed) throw notFound();
        if (row.status === 'deleted') return;
        const version = row.version + 1;
        await tx.update(agentMemoryRecords).set({ status: 'deleted', content: '', sourceRef: `deleted:${id}`, metadata: {}, indexStatus: 'pending', version, updatedAt: new Date() }).where(eq(agentMemoryRecords.id, id));
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'agent_memory.delete', targetType: 'agent_memory', targetId: id, idempotencyKey: digest(scope, key), detail: { partnerId: row.partnerId, scope: row.scope } }, tx);
        await this.outbox.write({ id: `agent-memory-index:${id}:${version}`, topic: 'agent-memory.index', payload: { memoryId: id } }, tx);
      });
      return { deleted: true };
    });
  }

  private async create(actor: CurrentUser, input: MemoryInput, scopeName: 'relationship' | 'agent'): Promise<MemoryView> {
    requirePartner(input.partnerId);
    const content = safeText(input.content);
    if (!['preference', 'interest', 'goal', 'teaching_strategy'].includes(input.kind)) throw inputError('记忆类型不允许');
    const scope = `agent-memory.create:${actor.id}:${input.partnerId}:${scopeName}`;
    return this.command(scope, input.idempotencyKey, { kind: input.kind, content, sourceRef: input.sourceRef ?? null }, async () => {
      const id = `memory-${digest(scope, input.idempotencyKey)}`;
      const now = new Date();
      const record = {
        id, studentId: scopeName === 'relationship' ? actor.id : null, partnerId: input.partnerId,
        scope: scopeName, kind: input.kind, content, sourceRef: scopeName === 'agent' ? input.sourceRef! : (input.sourceRef ?? `student_statement:${id}`),
        sourceEventId: id, status: 'active', version: 1, expiresAt: scopeName === 'relationship' ? new Date(now.getTime() + 90 * 86400000) : null,
        indexBackend: null, indexId: null, indexStatus: 'pending', metadata: { approvedBy: actor.id }, createdAt: now, updatedAt: now,
      } as const;
      await this.requireDb().transaction(async (tx) => {
        await tx.insert(agentMemoryRecords).values(record);
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: scopeName === 'agent' ? 'agent_memory.strategy_publish' : 'agent_memory.create', targetType: 'agent_memory', targetId: id, idempotencyKey: id, detail: { partnerId: record.partnerId, scope: scopeName, kind: record.kind } }, tx);
        await this.outbox.write({ id: `agent-memory-index:${id}:1`, topic: 'agent-memory.index', payload: { memoryId: id } }, tx);
      });
      return toView(toRecord(record));
    });
  }

  private async command<T>(scope: string, key: string, input: unknown, work: () => Promise<T>): Promise<T> {
    if (typeof key !== 'string' || !key.trim() || key.length > 160) throw inputError('必须携带有效 Idempotency-Key');
    try {
      const result = await this.idempotency.execute<T>(scope, key, hashRequest(input), async () => ({ status: 200, body: await work() }));
      return result.body;
    } catch (error) { throwHttpForIdempotencyError(error); }
  }

  private requireDb(): Database {
    if (this.db === null) throw new ServiceUnavailableException({ code: 'MEMORY_UNAVAILABLE', message: '记忆存储不可用' });
    return this.db;
  }
}

function digest(scope: string, key: string): string { return createHash('sha256').update(JSON.stringify([scope, key])).digest('hex'); }
function assertStudent(actor: CurrentUser): void { if (actor.role !== 'student') throw new ForbiddenException({ code: 'MEMORY_FORBIDDEN', message: '仅学生可以管理关系记忆' }); }
function requirePartner(value: string): void { if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,99}$/iu.test(value)) throw inputError('搭档标识无效'); }
function safeText(value: unknown): string { try { return validateMemoryText(value); } catch { throw inputError('记忆内容无效或包含敏感信息/指令'); } }
function inputError(message: string): BadRequestException { return new BadRequestException({ code: 'MEMORY_INPUT_INVALID', message }); }
function notFound(): NotFoundException { return new NotFoundException({ code: 'MEMORY_NOT_FOUND', message: '记忆不存在' }); }
export function toRecord(row: typeof agentMemoryRecords.$inferSelect): AgentMemoryRecord {
  return { id: row.id, studentId: row.studentId, partnerId: row.partnerId, scope: row.scope as AgentMemoryRecord['scope'], kind: row.kind as MemoryKind, content: row.content, sourceRef: row.sourceRef, sourceEventId: row.sourceEventId, status: row.status as AgentMemoryRecord['status'], version: row.version, expiresAt: row.expiresAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), indexId: row.indexId };
}
function toView(record: AgentMemoryRecord): MemoryView { const { studentId: _student, sourceEventId: _event, indexId: _index, ...view } = record; return view; }
