import { sql } from 'drizzle-orm';
import type { AuditTransaction } from '../../common/audit/audit.service';
import { deletePlans, deleteProjectContent, deleteSessions, inIds } from '../projects/student-history-cleanup.sql';
import { rowIds, type TemplateDeletionScope } from './template-deletion.scope';

export async function deleteTemplateRecords(tx: AuditTransaction, scope: TemplateDeletionScope) {
  const projectIds = rowIds(scope.projects), explorationIds = rowIds(scope.explorations);
  const versionIds = rowIds(scope.versions), artifactIds = rowIds(scope.artifacts);
  const sessionIds = rowIds(scope.sessions), turnIds = rowIds(scope.turns);
  const sourceIds = [...projectIds, ...explorationIds, ...artifactIds, ...rowIds(scope.plans), ...sessionIds,
    ...turnIds, ...rowIds(scope.growth), ...rowIds(scope.answers), ...rowIds(scope.verification), ...rowIds(scope.objectives),
    ...rowIds(scope.masteryEvents), ...rowIds(scope.artifactVersions), ...versionIds, String(scope.template.id)];
  const refs = [...sourceIds, ...turnIds.flatMap(id => [`turn:${id}`, `learning_interaction:${id}`]),
    ...projectIds.map(id => `project:${id}`), ...rowIds(scope.answers).map(id => `student_answer:${id}`)];

  // Tombstones preserve the existing asynchronous index-removal contract without retaining content.
  const memories = await tx.execute(sql`UPDATE agent_memory_records SET status='deleted',content='',
    source_ref='deleted:'||id,source_event_id='deleted:'||id,metadata='{}'::jsonb,index_status='pending',version=version+1,updated_at=now()
    WHERE status<>'deleted' AND (${inIds('source_ref', refs)} OR ${inIds('source_event_id', refs)}
      OR metadata->>'projectId' IN (${sql.join([...projectIds, ''].map(id => sql`${id}`), sql`,`)})
      OR metadata->>'sessionId' IN (${sql.join([...sessionIds, ''].map(id => sql`${id}`), sql`,`)}))
    RETURNING id,version`);

  // Cached exports contain copied growth summaries; revoke those referencing removed entries.
  await tx.execute(sql`UPDATE parent_growth_exports SET document=NULL,status='expired',expires_at=now()
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(document->'entries','[]'::jsonb)) entry
      WHERE entry->>'id' IN (${sql.join([...rowIds(scope.growth), ''].map(id => sql`${id}`), sql`,`)})
      OR entry->>'artifactRef' IN (${sql.join([...artifactIds, ''].map(id => sql`${id}`), sql`,`)}))`);
  const feedbackIds = rowIds(scope.feedback);
  for (const table of ['feedback_attachments', 'feedback_ticket_entries']) {
    await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${inIds('ticket_id', feedbackIds)}`);
  }
  await tx.execute(sql`DELETE FROM feedback_tickets WHERE ${inIds('id', feedbackIds)}`);
  await tx.execute(sql`DELETE FROM growth_records WHERE ${inIds('id', rowIds(scope.growth))}`);

  // Remove only references owned by this course; cited source projects are not transitively deleted.
  await tx.execute(sql`DELETE FROM template_verification_runs WHERE ${inIds('template_version_id', versionIds)}`);
  const students = new Set([...scope.sessions.map(row => String(row.student_id)), ...scope.runs.map(row => String(row.student_user_id))]);
  for (const studentId of students) {
    await deleteSessions(tx, rowIds(scope.sessions.filter(row => row.student_id === studentId)),
      rowIds(scope.runs.filter(row => row.student_user_id === studentId)), studentId);
  }
  await tx.execute(sql`DELETE FROM project_knowledge_bindings WHERE ${inIds('project_id', projectIds)}`);
  for (const project of scope.projects) await deleteProjectContent(tx, String(project.id), String(project.student_user_id));
  await deletePlans(tx, rowIds(scope.plans.filter(row => !row.project_id)));
  await tx.execute(sql`DELETE FROM artifacts WHERE ${inIds('id', artifactIds)}`);
  await tx.execute(sql`DELETE FROM pbl_gate_evidence WHERE ${inIds('evidence_ref', explorationIds.map(id => `intent_confirmation:${id}`))}`);
  await tx.execute(sql`DELETE FROM intent_confirmations WHERE ${inIds('exploration_id', explorationIds)}`);
  await tx.execute(sql`DELETE FROM exploration_sessions WHERE ${inIds('id', explorationIds)}`);
  await tx.execute(sql`DELETE FROM pbl_template_team_bindings WHERE ${inIds('template_version_id', versionIds)}`);
  await tx.execute(sql`DELETE FROM visual_bindings WHERE
    (owner_kind='template' AND owner_id=${String(scope.template.id)}) OR (owner_kind='template-version' AND ${inIds('owner_id', versionIds)})`);
  await tx.execute(sql`DELETE FROM project_template_versions WHERE ${inIds('id', versionIds)}`);
  await tx.execute(sql`DELETE FROM project_templates WHERE id=${String(scope.template.id)}`);

  // Exact JSON identities only: no title matching or substring-based deletion of other students' data.
  for (const [table, field] of [['idempotency_keys', 'response_body'], ['outbox', 'payload'], ['agent_team_events', 'payload']] as const) {
    await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE EXISTS
      (SELECT 1 FROM jsonb_path_query(${sql.identifier(field)},'$.**') value
        WHERE value #>> '{}' IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`,`)}))`);
  }
  for (const memory of memories.rows) {
    await tx.execute(sql`INSERT INTO outbox(id,topic,payload,status) VALUES
      (${`agent-memory-index:${memory.id}:${memory.version}`},'agent-memory.index',${JSON.stringify({ memoryId: memory.id })}::jsonb,'pending')
      ON CONFLICT(id) DO NOTHING`);
  }
}
