import { sql } from 'drizzle-orm';
import type { Database } from '@qitu/database';
import type { CoursewareInstance, CoursewareVersion } from '@qitu/contracts';
import { CoursewareStore, type CoursewareOperation } from './courseware.store';
import type { AuditTransaction } from '../../common/audit/audit.service';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const rows = <T>(value: unknown) => (value as { rows: T[] }).rows;
export class PostgresCoursewareStore extends CoursewareStore {
  constructor(private readonly db: Database, private readonly tx?: Transaction) { super(); }
  private get query() { return this.tx ?? this.db; }
  async transaction<T>(work: (store: CoursewareStore) => Promise<T>): Promise<T> {
    if (this.tx) return work(this);
    return this.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(26102349)`);
      return work(new PostgresCoursewareStore(this.db, tx));
    });
  }
  auditTransaction() { return this.tx as AuditTransaction | undefined; }
  async versions(status?: string): Promise<CoursewareVersion[]> {
    const result = status
      ? await this.query.execute(sql`SELECT payload FROM knowledge_courseware_versions WHERE status=${status} ORDER BY created_at DESC LIMIT 200`)
      : await this.query.execute(sql`SELECT payload FROM knowledge_courseware_versions ORDER BY created_at DESC LIMIT 200`);
    return rows<{ payload: CoursewareVersion }>(result).map(row => row.payload);
  }
  async version(id: string) { return rows<{ payload: CoursewareVersion }>(await this.query.execute(sql`SELECT payload FROM knowledge_courseware_versions WHERE id=${id}`))[0]?.payload ?? null; }
  async saveVersion(value: CoursewareVersion) {
    await this.query.execute(sql`INSERT INTO knowledge_courseware_versions(id,asset_id,parent_version_id,revision,status,payload)
      VALUES(${value.versionId},${value.assetId},${value.parentVersionId},${value.revision},${value.status},${JSON.stringify(value)}::jsonb)
      ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status,payload=EXCLUDED.payload,updated_at=now()`);
  }
  async instances(projectId: string, planId: string, revision: number, sessionId: string) {
    return rows<{ payload: CoursewareInstance }>(await this.query.execute(sql`SELECT payload FROM tutor_courseware_instances
      WHERE project_id=${projectId} AND plan_id=${planId} AND plan_revision=${revision} AND session_id=${sessionId} ORDER BY created_at`)).map(row => row.payload);
  }
  async instance(id: string) {
    const row = rows<{ payload: CoursewareInstance; request_hash: string }>(await this.query.execute(sql`SELECT payload,request_hash FROM tutor_courseware_instances WHERE id=${id}`))[0];
    return row ? { value: row.payload, hash: row.request_hash } : null;
  }
  async saveInstance(value: CoursewareInstance, hash: string) {
    await this.query.execute(sql`INSERT INTO tutor_courseware_instances(id,project_id,plan_id,plan_revision,session_id,activity_id,request_hash,payload)
      VALUES(${value.id},${value.projectId},${value.planId},${value.planRevision},${value.learningSessionId},${value.activityId},${hash},${JSON.stringify(value)}::jsonb)
      ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`);
  }
  async operation(id: string) {
    const row = rows<{ request_hash: string; response: unknown }>(await this.query.execute(sql`SELECT request_hash,response FROM knowledge_courseware_operations WHERE id=${id}`))[0];
    return row ? { hash: row.request_hash, response: row.response } : null;
  }
  async saveOperation(id: string, value: CoursewareOperation) {
    await this.query.execute(sql`INSERT INTO knowledge_courseware_operations(id,request_hash,response,project_id) VALUES(${id},${value.hash},${JSON.stringify(value.response)}::jsonb,${value.projectId ?? null})`);
  }
}
