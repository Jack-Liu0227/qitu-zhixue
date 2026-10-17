import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  KnowledgeCenterService,
  rows,
  checksum,
  type KnowledgeMember,
  type KnowledgeBaseRow,
} from './knowledge-center.service';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { KnowledgeSourceService } from './knowledge-source.service';
import { materializationAllowed, type SourcePolicy } from './knowledge-source.policy';

interface Job {
  id: string;
  kb_id: string;
  state: string;
  input_revision: number;
  fencing_token: number;
  attempts: number;
  operation: string;
}
/** Durable database queue with renewable leases and fenced publication. */
@Injectable()
export class KnowledgeBuildWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly engine: KnowledgeEngineService,
    private readonly sources: KnowledgeSourceService,
  ) {}
  onModuleInit() {
    if (process.env.QITU_KNOWLEDGE_WORKER === 'true')
      this.timer = setInterval(() => {
        void this.tick();
      }, 3000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async event(job: Job, state: string, detail: Record<string, unknown> = {}) {
    await this.center.database().transaction(async (tx) => {
      const current = rows(
        await tx.execute(
          sql`SELECT id FROM knowledge_jobs WHERE id=${job.id} AND fencing_token=${job.fencing_token} AND state<>'cancelled' FOR UPDATE`,
        ),
      );
      if (!current.length) throw new Error('JOB_LEASE_LOST');
      await tx.execute(
        sql`UPDATE knowledge_jobs SET state=${state},updated_at=now() WHERE id=${job.id}`,
      );
      await tx.execute(
        sql`UPDATE knowledge_bases SET build_state=${state},updated_at=now() WHERE id=${job.kb_id} AND revision=${job.input_revision} AND lifecycle='active'`,
      );
      await tx.execute(
        sql`INSERT INTO knowledge_job_events(job_id,event_seq,state,detail) SELECT ${job.id},coalesce(max(event_seq),0)+1,${state},${JSON.stringify(detail)}::jsonb FROM knowledge_job_events WHERE job_id=${job.id}`,
      );
    });
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    let job: Job | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      [job] = await this.center.query<Job>(
        sql`UPDATE knowledge_jobs SET state='discovering',attempts=attempts+1,fencing_token=fencing_token+1,lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=(SELECT id FROM knowledge_jobs WHERE (state='queued' OR (state NOT IN ('ready','empty','failed','cancelled') AND lease_until<now())) AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
      );
      if (!job) return;
      const active = job;
      heartbeat = setInterval(() => {
        void this.center
          .database()
          .execute(
            sql`UPDATE knowledge_jobs SET lease_until=now()+interval '90 seconds' WHERE id=${active.id} AND fencing_token=${active.fencing_token} AND state<>'cancelled'`,
          )
          .catch(() => {});
      }, 20_000);
      await this.build(job);
    } catch {
      if (job) await this.fail(job, 'KNOWLEDGE_PREPARATION_FAILED').catch(() => {});
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.busy = false;
    }
  }
  private async fail(job: Job, code: string, state = 'failed') {
    const retryable =
      ['ENGINE_EXECUTION_FAILED', 'INDEX_BUILD_FAILED', 'KNOWLEDGE_PREPARATION_FAILED'].includes(
        code,
      ) && job.attempts < 3;
    if (retryable) state = 'queued';
    await this.event(job, state, { errorCode: code });
    await this.center.database().transaction(async (tx) => {
      const updated = rows(
        await tx.execute(
          sql`UPDATE knowledge_jobs SET error_code=${code},lease_until=NULL,next_attempt_at=now()+${retryable ? job.attempts * 30 : 0}*interval '1 second' WHERE id=${job.id} AND fencing_token=${job.fencing_token} AND state=${state} RETURNING id`,
        ),
      );
      if (updated.length)
        await tx.execute(
          sql`UPDATE knowledge_bases SET build_state=${state} WHERE id=${job.kb_id} AND revision=${job.input_revision}`,
        );
    });
  }
  private async build(job: Job) {
    const [base] = await this.center.query<KnowledgeBaseRow>(
      sql`SELECT k.*,coalesce(u.school_id,k.school_id) school_id FROM knowledge_bases k LEFT JOIN users u ON u.id=k.owner_user_id WHERE k.id=${job.kb_id} AND k.lifecycle='active'`,
    );
    if (!base || base.revision !== job.input_revision)
      return this.fail(job, 'INPUT_REVISION_CHANGED');
    const { revision: configRevision, config } = await this.center.configuration();
    const target =
      base.engine_instance_id ??
      Object.keys(config.knowledgeEngines).find(
        (id) =>
          config.knowledgeEngines[id]?.provider === 'llamaindex' &&
          config.knowledgeEngines[id]?.enabled,
      );
    const engine = target ? config.knowledgeEngines[target] : undefined;
    if (!engine?.enabled) return this.fail(job, 'ENGINE_NOT_READY');
    const check = await this.engine.check(target!);
    if (!check.ok) return this.fail(job, check.errorCode ?? 'ENGINE_NOT_READY');
    await this.event(job, 'planning', {
      planner: 'metadata-rules',
      reason: '专用规划模型未绑定，采用已记录的元数据规则',
    });
    if (base.kind === 'project') {
      const imported = await this.sources.discover(base.name.replace(/知识库$/, ''));
      await this.event(job, 'discovering', imported);
      const sources = (
        await this.center.query<KnowledgeMember & SourcePolicy>(
          sql`SELECT m.*,k.kind,k.lifecycle,k.owner_user_id,k.school_id,k.engine_instance_id FROM knowledge_base_members m JOIN knowledge_bases k ON k.id=m.kb_id WHERE k.kind<>'project' AND k.lifecycle='active' AND m.visibility='active' AND m.origin->>'canMaterialize'='true' AND (k.kind='platform' OR (k.kind='school' AND k.school_id=${base.school_id}) OR (k.kind='student' AND k.owner_user_id=${base.owner_user_id})) ORDER BY m.created_at DESC LIMIT 200`,
        )
      ).filter((s) => materializationAllowed(s, base, config));
      const words = Array.from(
        new Set(
          base.name
            .replace(/知识库$/, '')
            .toLowerCase()
            .match(/[a-z0-9]+|[\u4e00-\u9fff]{2}/g) ?? [],
        ),
      );
      const selected = sources
        .map((m) => ({
          m,
          score: words.filter((w) =>
            (m.title + ' ' + m.content.slice(0, 1000)).toLowerCase().includes(w),
          ).length,
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      if (!selected.length) return this.fail(job, 'NO_ELIGIBLE_SOURCE', 'empty');
      await this.event(job, 'collecting', {
        selectedDocuments: selected.length,
        catalogDocuments: sources.length,
        catalogComplete: sources.length < 200,
      });
      for (const { m } of selected) {
        const sourceBase = (await this.center.bases()).find((k) => k.id === m.kb_id);
        if (
          sourceBase?.engine_instance_id &&
          !config.knowledgeEngines[sourceBase.engine_instance_id]?.enabled
        )
          continue;
        const memberId = `pm-${checksum(`${base.id}:${m.id}`).slice(0, 48)}`;
        await this.center
          .database()
          .execute(
            sql`INSERT INTO knowledge_base_members(id,kb_id,title,content,checksum,source_revision,origin) VALUES(${memberId},${base.id},${m.title},${m.content},${m.checksum},${m.source_revision},${JSON.stringify({ ...m.origin, sourceMemberId: m.id, sourceKnowledgeBaseId: m.kb_id, sourceRevision: m.source_revision })}::jsonb) ON CONFLICT(kb_id,checksum) DO NOTHING`,
          );
      }
    }
    let members = await this.center.query<KnowledgeMember>(
      sql`SELECT * FROM knowledge_base_members WHERE kb_id=${base.id} AND visibility='active' ORDER BY created_at`,
    );
    if (base.kind === 'project') {
      const sources = await this.center.query<KnowledgeMember & SourcePolicy>(
        sql`SELECT m.*,k.kind,k.lifecycle,k.owner_user_id,k.school_id,k.engine_instance_id FROM knowledge_base_members m JOIN knowledge_bases k ON k.id=m.kb_id WHERE m.id IN (SELECT origin->>'sourceMemberId' FROM knowledge_base_members WHERE kb_id=${base.id})`,
      );
      members = members.filter((m) =>
        sources.some(
          (s) =>
            s.id === m.origin.sourceMemberId &&
            s.checksum === m.checksum &&
            materializationAllowed(s, base, config),
        ),
      );
    }
    if (!members.length) return this.fail(job, 'NO_ELIGIBLE_SOURCE', 'empty');
    if (
      members.length > 20 ||
      members.reduce((n, m) => n + Buffer.byteLength(m.content), 0) > 7 * 1024 * 1024
    )
      return this.fail(job, 'MATERIAL_BUDGET_EXCEEDED');
    await this.event(job, 'indexing', { documents: members.length });
    const versionId = randomUUID();
    const receipt = await this.engine.execute(engine, {
      operation: 'build',
      kbId: base.id,
      versionId,
      members: members.map((m) => ({ id: m.id, content: m.content })),
      testQuery: members[0]!.title,
    });
    if (!receipt.ok) return this.fail(job, receipt.errorCode ?? 'INDEX_BUILD_FAILED');
    await this.event(job, 'validating');
    await this.center.database().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(281017)`);
      const [fresh] = rows<{ revision: number }>(
        await tx.execute(
          sql`SELECT revision FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`,
        ),
      );
      const [lease] = rows(
        await tx.execute(
          sql`SELECT id FROM knowledge_jobs WHERE id=${job.id} AND fencing_token=${job.fencing_token} AND lease_until>now() AND state='validating' FOR UPDATE`,
        ),
      );
      const [current] = rows<{ revision: number }>(
        await tx.execute(
          sql`SELECT revision FROM knowledge_bases WHERE id=${base.id} AND lifecycle='active' FOR UPDATE`,
        ),
      );
      if (
        !lease ||
        !fresh ||
        fresh.revision !== configRevision ||
        current?.revision !== job.input_revision
      )
        throw new Error('PUBLISH_FENCE_CHANGED');
      // Source mutation is checked again in the publish transaction, not only at discovery.
      const revoked = rows(
        await tx.execute(
          sql`SELECT p.id FROM knowledge_base_members p LEFT JOIN knowledge_base_members s ON s.id=p.origin->>'sourceMemberId' LEFT JOIN knowledge_bases k ON k.id=s.kb_id WHERE p.kb_id=${base.id} AND p.origin ? 'sourceMemberId' AND (s.id IS NULL OR s.visibility<>'active' OR s.checksum<>p.checksum OR k.lifecycle<>'active' OR s.origin->>'canMaterialize'<>'true')`,
        ),
      );
      if (revoked.length) throw new Error('SOURCE_AUTHORIZATION_CHANGED');
      await tx.execute(
        sql`INSERT INTO knowledge_index_versions(id,kb_id,status,config_snapshot,artifact_ref,manifest) VALUES(${versionId},${base.id},'ready',${JSON.stringify({ engine, configRevision })}::jsonb,${versionId},${JSON.stringify({ ...receipt.manifest, memberIds: members.map((m) => m.id) })}::jsonb)`,
      );
      await tx.execute(
        sql`UPDATE knowledge_bases SET active_index_version_id=${versionId},engine_instance_id=${target!},build_state='ready',updated_at=now() WHERE id=${base.id}`,
      );
      await tx.execute(
        sql`UPDATE knowledge_jobs SET state='ready',lease_until=NULL,error_code=NULL,updated_at=now() WHERE id=${job.id}`,
      );
      await tx.execute(
        sql`INSERT INTO knowledge_job_events(job_id,event_seq,state,detail) SELECT ${job.id},coalesce(max(event_seq),0)+1,'ready',${JSON.stringify({ versionId, documents: members.length })}::jsonb FROM knowledge_job_events WHERE job_id=${job.id}`,
      );
    });
  }
}
