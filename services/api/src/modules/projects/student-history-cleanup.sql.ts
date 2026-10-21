import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AuditTransaction } from '../../common/audit/audit.service';

export function inIds(column: string, ids: readonly string[]) {
  return ids.length ? sql`${sql.identifier(column)} IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})` : sql`false`;
}
async function remove(tx: AuditTransaction, table: string, column: string, ids: readonly string[]) {
  if (ids.length) await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${inIds(column, ids)}`);
}

export async function deleteSessions(tx: AuditTransaction, ids: string[], runIds: string[], studentId: string) {
  if (!ids.length && !runIds.length) return;
  const turns = await tx.execute(sql`SELECT id FROM tutor_turns WHERE ${inIds('session_id', ids)}`);
  const turnIds = turns.rows.map(row => String(row.id));
  const refs = [...turnIds, ...turnIds.map(turnId => `turn:${turnId}`), ...turnIds.map(turnId => `learning_interaction:${turnId}`)];
  await tx.execute(sql`DELETE FROM agent_memory_records WHERE student_id=${studentId}
    AND (${inIds('source_ref', refs)} OR ${inIds('source_event_id', refs)}
      OR metadata->>'sessionId' IN (${sql.join([...ids, ''].map(id => sql`${id}`), sql`,`)}))`);
  await tx.execute(sql`DELETE FROM outbox WHERE payload->>'sessionId' IN (${sql.join([...ids, ''].map(id => sql`${id}`), sql`,`)})
    OR payload->'payload'->>'sessionId' IN (${sql.join([...ids, ''].map(id => sql`${id}`), sql`,`)})`);
  await tx.execute(sql`DELETE FROM agent_team_events WHERE payload->>'sessionId' IN (${sql.join([...ids, ''].map(id => sql`${id}`), sql`,`)})`);
  await tx.execute(sql`DELETE FROM agent_projection_candidates WHERE ${inIds('run_id', runIds)}
    OR (student_user_id=${studentId} AND (payload->>'sessionId' IN (${sql.join([...ids, ''].map(id => sql`${id}`), sql`,`)})
      OR payload->'evidenceRefs' ?| ARRAY[${sql.join([...refs, ''].map(ref => sql`${ref}`), sql`,`) }]::text[]))`);
  const mailboxes = await tx.execute(sql`SELECT mailbox_agent_id,count(*)::int pending FROM agent_team_messages
    WHERE ${inIds('run_id', runIds)} AND status='queued' GROUP BY mailbox_agent_id`);
  for (const row of mailboxes.rows) await tx.execute(sql`UPDATE agent_mailboxes SET pending_count=greatest(0,pending_count-${Number(row.pending)})
    WHERE agent_id=${String(row.mailbox_agent_id)}`);
  await remove(tx, 'agent_team_runs', 'id', runIds);
  // Keep independent assessment facts. Migration 0047 detaches their conversation FK.
  await remove(tx, 'tutor_turns', 'session_id', ids);
  await remove(tx, 'tutor_sessions', 'id', ids);
  // Cached HTTP responses must not provide another copy of deleted conversation text.
  await tx.execute(sql`DELETE FROM idempotency_keys WHERE
    response_body->>'sessionId' IN (${sql.join([...ids, ''].map(id => sql`${id}`), sql`,` )})
    OR response_body->'data'->>'sessionId' IN (${sql.join([...ids, ''].map(id => sql`${id}`), sql`,` )})
    OR ${inIds('scope', ids.map(id => `tutor.turn:${id}`))}`);
}

export async function deletePlans(tx: AuditTransaction, planIds: string[], projectId?: string) {
  const events = await tx.execute(sql`SELECT id FROM mastery_events WHERE ${inIds('plan_id', planIds)}
    OR ${projectId ? sql`project_id=${projectId}` : sql`false`}`);
  await remove(tx, 'mastery_graph_receipts', 'event_id', events.rows.map(row => String(row.id)));
  await remove(tx, 'mastery_events', 'id', events.rows.map(row => String(row.id)));
  await remove(tx, 'answer_attempts', 'plan_id', planIds);
  await remove(tx, 'project_plan_adjustments', 'plan_id', planIds);
  await remove(tx, 'learning_plans', 'id', planIds);
}

export async function deleteProjectContent(tx: AuditTransaction, id: string, studentId: string) {
  const plans = await tx.execute(sql`SELECT id,student_user_id FROM learning_plans WHERE project_id=${id} FOR UPDATE`);
  if (plans.rows.some(row => row.student_user_id !== studentId)) throw new ConflictException('计划归属异常，未执行删除');
  const kbs = await tx.execute(sql`SELECT id FROM knowledge_bases WHERE project_id=${id} FOR UPDATE`);
  const kbIds = kbs.rows.map(row => String(row.id));
  const jobs = await tx.execute(sql`SELECT id,state FROM knowledge_jobs WHERE ${inIds('kb_id', kbIds)} FOR UPDATE`);
  if (jobs.rows.some(row => ['running','processing'].includes(String(row.state)))) {
    throw new ConflictException({ code: 'HISTORY_DELETE_BUSY', message: '项目资料仍在处理中，请完成后重试' });
  }
  const shared = await tx.execute(sql`SELECT project_id FROM project_knowledge_bindings WHERE ${inIds('kb_id', kbIds)} AND project_id<>${id}`);
  if (shared.rows.length) throw new ConflictException({ code: 'PROJECT_DELETE_SHARED_KNOWLEDGE', message: '项目资料库仍被其他项目引用，请管理员先解除共享' });
  await remove(tx, 'knowledge_job_events', 'job_id', jobs.rows.map(row => String(row.id)));
  await remove(tx, 'knowledge_jobs', 'kb_id', kbIds);
  const members = await tx.execute(sql`SELECT id FROM knowledge_base_members WHERE ${inIds('kb_id', kbIds)}`);
  await remove(tx, 'knowledge_file_originals', 'member_id', members.rows.map(row => String(row.id)));
  await remove(tx, 'knowledge_base_members', 'kb_id', kbIds);
  await remove(tx, 'knowledge_index_versions', 'kb_id', kbIds);
  await tx.execute(sql`DELETE FROM project_knowledge_bindings WHERE project_id=${id}`);
  await remove(tx, 'knowledge_bases', 'id', kbIds);
  // Shared library documents remain library-owned; unlink their project attribution.
  await tx.execute(sql`UPDATE knowledge_documents SET project_id=NULL WHERE project_id=${id}
    AND (owner_user_id IS DISTINCT FROM ${studentId} OR EXISTS
      (SELECT 1 FROM knowledge_base_members m WHERE m.document_id=knowledge_documents.id))`);
  await tx.execute(sql`DELETE FROM knowledge_documents WHERE project_id=${id} AND owner_user_id=${studentId}`);
  await deletePlans(tx, plans.rows.map(row => String(row.id)), id);
  for (const table of ['project_evidence','work_assessment_candidates','work_validation_checks','artifacts',
    'growth_records','mentor_reviews','project_binding_snapshots','project_plan_adjustments','learning_session_progress',
    'student_project_display','tutor_growth_signals','tutor_knowledge_documents','tutor_template_documents','agent_projection_candidates']) {
    await remove(tx, table, 'project_id', [id]);
  }
  await tx.execute(sql`DELETE FROM agent_memory_records WHERE student_id=${studentId} AND metadata->>'projectId'=${id}`);
  await tx.execute(sql`DELETE FROM outbox WHERE payload->>'projectId'=${id} OR payload->'payload'->>'projectId'=${id}`);
  await tx.execute(sql`UPDATE student_project_lists SET current_project_id=NULL,version=version+1
    WHERE student_user_id=${studentId} AND current_project_id=${id}`);
  await tx.execute(sql`DELETE FROM projects WHERE id=${id} AND student_user_id=${studentId}`);
}
