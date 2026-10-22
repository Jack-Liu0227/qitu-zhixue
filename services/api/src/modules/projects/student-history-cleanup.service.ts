import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { projectStageLabel, type CurrentUser, type StudentConversationHistoryItem, type StudentHistoryDeleteKind } from '@qitu/contracts';
import type { Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter, type AuditTransaction } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashRequest } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { deletePlans, deleteProjectContent, deleteSessions, inIds } from './student-history-cleanup.sql';

@Injectable()
export class StudentHistoryCleanupService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter, private readonly idempotency: IdempotencyStore) {}

  async conversations(actor: CurrentUser): Promise<StudentConversationHistoryItem[]> {
    if (actor.role !== 'student') throw new ForbiddenException('仅学生本人可读取会话历史');
    if (!this.db) throw new ServiceUnavailableException('会话历史暂不可用');
    const result = await this.db.execute(sql`WITH scoped AS (SELECT p.id project_id,
      CASE WHEN p.id IS NULL THEN e.id ELSE NULL END exploration_id,p.status,
      coalesce(p.title,nullif(btrim(tpl.title),''),nullif(btrim(i.goal_user),''),'自由探索') title,
      greatest(s.created_at,coalesce(t.created_at,s.created_at)) updated_at,t.id turn_id,
      s.exploration_id IS NOT NULL includes_exploration
      FROM tutor_sessions s
      LEFT JOIN exploration_sessions e ON e.id=s.exploration_id AND e.student_user_id=${actor.id}
      LEFT JOIN projects p ON (p.id=s.project_id OR (s.project_id IS NULL AND p.source_exploration_id=e.id)) AND p.student_user_id=${actor.id}
      LEFT JOIN project_template_versions v ON v.id=e.template_version_id
      LEFT JOIN project_templates tpl ON tpl.id=v.template_id
      LEFT JOIN intent_confirmations i ON i.exploration_id=e.id LEFT JOIN tutor_turns t ON t.session_id=s.id
      WHERE s.student_id=${actor.id} AND (p.id IS NOT NULL OR (s.project_id IS NULL AND e.id IS NOT NULL))
      ) SELECT project_id,exploration_id,status,title,max(updated_at) updated_at,count(DISTINCT turn_id)::int turn_count,
      bool_or(includes_exploration) includes_exploration FROM scoped
      GROUP BY project_id,exploration_id,status,title ORDER BY updated_at DESC,coalesce(project_id,exploration_id) DESC LIMIT 100`);
    return result.rows.map(row => ({ id: String(row.project_id ?? row.exploration_id), title: String(row.title),
      kind: row.project_id ? 'project' : 'exploration',
      ...(row.project_id ? { projectId: String(row.project_id), stageLabel: projectStageLabel(String(row.status)) }
        : { explorationId: String(row.exploration_id) }),
      ...(row.project_id && row.includes_exploration ? { includesExploration: true } : {}),
      updatedAt: new Date(String(row.updated_at)).toISOString(), turnCount: Number(row.turn_count) }));
  }

  async remove(actor: CurrentUser, rawKind: string, id: string, key: string | undefined) {
    if (actor.role !== 'student') throw new ForbiddenException({ code: 'HISTORY_DELETE_FORBIDDEN', message: '只能删除自己的记录' });
    if (!['project', 'exploration', 'plan', 'conversation'].includes(rawKind) || !id.trim() || id.length > 200
      || !key?.trim() || key.length > 160) throw new BadRequestException({ code: 'HISTORY_DELETE_INVALID', message: '删除参数或幂等键无效' });
    if (!this.db) throw new ServiceUnavailableException({ code: 'HISTORY_DELETE_UNAVAILABLE', message: '删除服务暂不可用' });
    const kind = rawKind as StudentHistoryDeleteKind;
    const db = this.db;
    try {
      const result = await this.idempotency.execute(`student.history.delete:${actor.id}`, key, hashRequest({ kind, id }), async () => {
        const body = await db.transaction(async tx => {
          // Every root is locked and ownership is checked before any destructive statement.
          const table = kind === 'exploration' ? 'exploration_sessions' : kind === 'plan' ? 'learning_plans' : 'projects';
          const root = (await tx.execute(sql`SELECT * FROM ${sql.identifier(table)} WHERE id=${id} FOR UPDATE`)).rows[0];
          if (!root || root.student_user_id !== actor.id) throw new ForbiddenException({ code: 'HISTORY_DELETE_FORBIDDEN', message: '记录不存在或无权删除' });
          if (kind === 'plan' && (root.status !== 'draft' || root.project_id !== null)) {
            throw new ConflictException({ code: 'PLAN_DELETE_CONFIRMED', message: '计划已确认，请在我的项目中删除对应项目' });
          }
          if (kind === 'exploration' && (await tx.execute(sql`SELECT id FROM projects WHERE source_exploration_id=${id}`)).rows.length) {
            throw new ConflictException({ code: 'EXPLORATION_DELETE_CONFIRMED', message: '探索已创建正式项目，请删除对应项目' });
          }
          const explorationIds = kind === 'exploration' ? [id]
            : (kind === 'project' || kind === 'conversation') && typeof root.source_exploration_id === 'string' ? [root.source_exploration_id] : [];
          if (explorationIds.length) {
            const explorations = await tx.execute(sql`SELECT id,student_user_id FROM exploration_sessions WHERE ${inIds('id', explorationIds)} FOR UPDATE`);
            if (explorations.rows.some(row => row.student_user_id !== actor.id)) throw new ConflictException('探索归属异常，未执行删除');
          }
          const sessions = await tx.execute(sql`SELECT id,student_id FROM tutor_sessions WHERE
            ${(kind === 'project' || kind === 'conversation') ? sql`project_id=${id}` : sql`false`}
            OR ${inIds('exploration_id', explorationIds)} FOR UPDATE`);
          if (sessions.rows.some(row => row.student_id !== actor.id)) throw new ConflictException('会话归属异常，未执行删除');
          const sessionIds = sessions.rows.map(row => String(row.id));
          const runs = await tx.execute(sql`SELECT id,status,student_user_id,lease_expires_at FROM agent_team_runs WHERE
            ${(kind === 'project') ? sql`project_id=${id}` : sql`false`} OR ${inIds('tutor_session_id', sessionIds)} FOR UPDATE`);
          const runIds = runs.rows.map(row => String(row.id));
          const leasedTasks = await tx.execute(sql`SELECT id FROM agent_team_tasks WHERE ${inIds('run_id', runIds)}
            AND status='running' AND lease_expires_at>now() FOR UPDATE`);
          const leasedMessages = await tx.execute(sql`SELECT id FROM agent_team_messages WHERE ${inIds('run_id', runIds)}
            AND status='processing' AND lease_expires_at>now() FOR UPDATE`);
          if (runs.rows.some(row => row.lease_expires_at && Date.parse(String(row.lease_expires_at)) > Date.now())
            || leasedTasks.rows.length || leasedMessages.rows.length) {
            throw new ConflictException({ code: 'HISTORY_DELETE_BUSY', message: '导师团队仍在处理，请等待当前回复完成后重试' });
          }
          if (runs.rows.some(row => row.student_user_id !== actor.id)) throw new ConflictException('导师任务归属异常，未执行删除');
          await deleteSessions(tx, sessionIds, runIds, actor.id);
          if (kind === 'conversation') await tx.execute(sql`UPDATE projects SET tutor_conversation_generation=tutor_conversation_generation+1 WHERE id=${id}`);
          if (kind === 'project') await deleteProjectContent(tx, id, actor.id);
          if (kind === 'plan') await deletePlans(tx, [id]);
          if (explorationIds.length && kind !== 'conversation') {
            await tx.execute(sql`DELETE FROM pbl_gate_evidence WHERE student_user_id=${actor.id}
              AND ${inIds('evidence_ref', explorationIds.map(value => `intent_confirmation:${value}`))}`);
            await tx.execute(sql`DELETE FROM intent_confirmations WHERE ${inIds('exploration_id', explorationIds)}`);
            // Project is removed first because it references its original exploration.
            await tx.execute(sql`DELETE FROM exploration_sessions WHERE ${inIds('id', explorationIds)}`);
          }
          await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'student.history.permanently_deleted',
            targetType: kind, targetId: id, idempotencyKey: `student.history.delete:${actor.id}:${key}`, detail: { kind, sessionCount: sessionIds.length, permanent: true } }, tx);
          return { id, kind, deleted: true as const };
        });
        return { status: 200, body };
      });
      return { ...result.body, replayed: result.replayed };
    } catch (error) { throwHttpForIdempotencyError(error); throw error; }
  }
}
