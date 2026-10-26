import { createHash } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditTransaction } from '../../common/audit/audit.service';
import { inIds } from '../projects/student-history-cleanup.sql';
import { assertTemplateDeletable } from './templates.store';
import type { TemplateStatus } from './templates.types';

type Row = Record<string, unknown>;
export const rowIds = (rows: Row[]) => rows.map(row => String(row.id));

export interface TemplateDeletionImpact {
  templateId: string; title: string; fingerprint: string;
  counts: Record<string, number>;
}

export async function collectTemplateDeletion(tx: AuditTransaction, templateId: string, lock: boolean) {
  const suffix = lock ? sql`FOR UPDATE` : sql``;
  async function rows(table: string, where: SQL, columns = 'id') {
    return (await tx.execute(sql`SELECT ${sql.raw(columns)} FROM ${sql.identifier(table)} WHERE ${where} ORDER BY id ${suffix}`)).rows;
  }
  const template = (await rows('project_templates', sql`id=${templateId}`, 'id,title,status,updated_at'))[0];
  if (!template) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: '课程不存在或已删除' });
  const versions = await rows('project_template_versions', sql`template_id=${templateId}`, 'id,status');
  assertTemplateDeletable(template.status as TemplateStatus, versions.map(row => row.status as TemplateStatus));
  const versionIds = rowIds(versions);
  const directExplorations = await rows('exploration_sessions', inIds('template_version_id', versionIds));
  const projects = await rows('projects', sql`${inIds('template_version_id', versionIds)}
    OR ${inIds('source_exploration_id', rowIds(directExplorations))}
    OR id IN (SELECT project_id FROM project_binding_snapshots WHERE ${inIds('template_version_id', versionIds)})
    OR id IN (SELECT project_id FROM learning_plans WHERE ${inIds('template_version_id', versionIds)})
    OR id IN (SELECT project_id FROM artifacts WHERE ${inIds('template_version_id', versionIds)})`, 'id,student_user_id,source_exploration_id,status');
  const projectIds = rowIds(projects);
  const explorations = await rows('exploration_sessions', sql`${inIds('template_version_id', versionIds)}
    OR ${inIds('id', projects.flatMap(row => typeof row.source_exploration_id === 'string' ? [row.source_exploration_id] : []))}`, 'id,student_user_id,status,updated_at');
  const plans = await rows('learning_plans', sql`${inIds('template_version_id', versionIds)} OR ${inIds('project_id', projectIds)}`, 'id,student_user_id,project_id,status');
  const artifacts = await rows('artifacts', sql`${inIds('template_version_id', versionIds)} OR ${inIds('project_id', projectIds)}`, 'id,student_user_id,project_id,status');
  const sessions = await rows('tutor_sessions', sql`${inIds('project_id', projectIds)} OR ${inIds('exploration_id', rowIds(explorations))}`, 'id,student_id');
  const runs = await rows('agent_team_runs', sql`${inIds('project_id', projectIds)} OR ${inIds('tutor_session_id', rowIds(sessions))}`, 'id,student_user_id,lease_expires_at');
  const verification = await rows('template_verification_runs', inIds('template_version_id', versionIds));
  const records = {
    versions, projects, explorations, plans, artifacts, sessions, runs, verification,
    verificationEvidence: await rows('template_verification_evidence', inIds('run_id', rowIds(verification))),
    turns: await rows('tutor_turns', inIds('session_id', rowIds(sessions))),
    growth: await rows('growth_records', sql`${inIds('project_id', projectIds)} OR ${inIds('artifact_ref', rowIds(artifacts))}`),
    knowledge: await rows('knowledge_bases', inIds('project_id', projectIds)),
    feedback: await rows('feedback_tickets', inIds('project_id', projectIds)),
    answers: await rows('answer_attempts', inIds('plan_id', rowIds(plans))),
    objectives: await rows('learning_objectives', inIds('plan_id', rowIds(plans))),
    masteryEvents: await rows('mastery_events', sql`${inIds('plan_id', rowIds(plans))} OR ${inIds('project_id', projectIds)}`),
    artifactVersions: await rows('artifact_versions', inIds('artifact_id', rowIds(artifacts))),
    bindings: await rows('pbl_template_team_bindings', inIds('template_version_id', versionIds)),
  };
  // Only bounded identity/revision metadata enters the confirmation fingerprint and response.
  const fingerprint = createHash('sha256').update(JSON.stringify({
    template: [template.id, template.title, template.status, template.updated_at],
    records,
  })).digest('hex');
  const students = new Set([...projects, ...explorations, ...plans, ...artifacts].map(row => row.student_user_id).filter(Boolean));
  const impact: TemplateDeletionImpact = { templateId, title: String(template.title), fingerprint,
    counts: { students: students.size, ...Object.fromEntries(Object.entries(records).map(([key, value]) => [key, value.length])) } };
  return { template, ...records, impact };
}

export type TemplateDeletionScope = Awaited<ReturnType<typeof collectTemplateDeletion>>;

export async function assertTemplateDeletionIdle(tx: AuditTransaction, scope: TemplateDeletionScope) {
  const runIds = rowIds(scope.runs);
  const tasks = await tx.execute(sql`SELECT id,lease_expires_at FROM agent_team_tasks WHERE ${inIds('run_id', runIds)} FOR UPDATE`);
  const messages = await tx.execute(sql`SELECT id,lease_expires_at FROM agent_team_messages WHERE ${inIds('run_id', runIds)} FOR UPDATE`);
  if ([...tasks.rows, ...messages.rows, ...scope.runs].some(row => row.lease_expires_at &&
    new Date(String(row.lease_expires_at)).getTime() > Date.now())) {
    throw new ConflictException({ code: 'TEMPLATE_DELETE_BUSY', message: '关联项目的 AI 仍在处理，请等待当前任务完成后重试。' });
  }
  const shared = await tx.execute(sql`SELECT id FROM project_evidence WHERE ${inIds('artifact_id', rowIds(scope.artifacts))}
    AND NOT (${inIds('project_id', rowIds(scope.projects))}) LIMIT 1`);
  if (shared.rows.length) throw new ConflictException({ code: 'TEMPLATE_DELETE_SHARED', message: '作品仍被其他课程的项目引用，请先解除共享后重试。' });
}
