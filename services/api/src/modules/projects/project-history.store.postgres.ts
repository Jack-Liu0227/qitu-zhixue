import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditTransaction } from '../../common/audit/audit.service';
import { sql, and, eq } from 'drizzle-orm';
import { studentProjectLists, studentProjectDisplay, projects, type Database } from '@qitu/database';
import type { ProjectDisplayChange, ProjectHistoryItem } from '@qitu/contracts';
import { ProjectHistoryStore, type ProjectHistoryQuery, type ProjectHistorySnapshot } from './project-history.store';

/** One statement returns a consistent page, grouped counts and revision, without conversation content. */
export class PostgresProjectHistoryStore extends ProjectHistoryStore {
  constructor(private readonly db: Database) { super(); }
  async query(studentId: string, query: ProjectHistoryQuery): Promise<ProjectHistorySnapshot> {
    const search = '%' + query.q.replace(/[\\%_]/g, '\\$&') + '%';
    const result = await this.db.execute(sql`
      WITH entries AS (
        SELECT 'project'::text kind, p.id, p.title, coalesce(p.subtitle,'') subtitle, p.tags, p.status,
          coalesce(p.template_version_id,'unknown') template_version_id, p.current_stage_index, p.stage_total,
          p.progress_percent, p.created_at, d.collected_at,
          CASE WHEN p.status IN ('completed','published') THEN 'done' ELSE 'active' END category
        FROM projects p LEFT JOIN student_project_display d ON d.project_id=p.id AND d.student_user_id=${studentId}
        WHERE p.student_user_id=${studentId}
        UNION ALL
        SELECT 'exploration', e.id, coalesce(nullif(btrim(tpl.title),''),nullif(btrim(i.goal_user),''),'自由探索'), '', '[]'::jsonb, 'exploration',
          coalesce(e.template_version_id,'unknown'), 0, 0, 0, e.created_at, NULL::timestamptz, 'draft'
        FROM exploration_sessions e LEFT JOIN intent_confirmations i ON i.exploration_id=e.id
        LEFT JOIN project_template_versions v ON v.id=e.template_version_id
        LEFT JOIN project_templates tpl ON tpl.id=v.template_id
        WHERE e.student_user_id=${studentId} AND e.status IN ('exploring','awaiting_confirmation')
        UNION ALL
        SELECT 'plan', l.id, left(l.goal,200), left(l.interest,300), '[]'::jsonb, 'exploration',
          coalesce(l.template_version_id,'unknown'), 0, 0, 0, l.created_at, NULL::timestamptz, 'draft'
        FROM learning_plans l WHERE l.student_user_id=${studentId} AND l.status='draft' AND l.project_id IS NULL
      ), filtered AS (
        SELECT * FROM entries WHERE (${query.includeCollected} OR collected_at IS NULL)
          AND (title ILIKE ${search} OR subtitle ILIKE ${search})
      ), meta AS (
        SELECT md5(coalesce(string_agg(md5(row_to_json(e)::text),'' ORDER BY kind,id),'')) revision FROM entries e
      ), page AS (
        SELECT * FROM filtered WHERE (${query.tab}='all' OR category=${query.tab})
          ${query.after ? sql`AND (created_at,id,kind) < (${query.after.createdAt}::timestamptz,${query.after.id},${query.after.kind})` : sql``}
        ORDER BY created_at DESC,id DESC,kind DESC LIMIT ${query.limit + 1}
      ) SELECT (SELECT coalesce(jsonb_agg(row_to_json(p) ORDER BY created_at DESC,id DESC,kind DESC),'[]'::jsonb) FROM page p) items,
        (SELECT revision FROM meta) revision,
        (SELECT count(*)::int FROM filtered WHERE category='active') active,
        (SELECT count(*)::int FROM filtered WHERE category='draft') draft,
        (SELECT count(*)::int FROM filtered WHERE category='done') done,
        coalesce((SELECT version FROM student_project_lists WHERE student_user_id=${studentId}),0) version,
        (SELECT current_project_id FROM student_project_lists WHERE student_user_id=${studentId}) current_project_id,
        (SELECT id FROM entries WHERE kind='project' AND category='active' AND collected_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1) recommended_project_id`);
    const row = result.rows[0] as { items: Array<Record<string, unknown>>; revision: string; active: number; draft: number; done: number; version: number; current_project_id: string | null; recommended_project_id: string | null };
    const revision = `${row.version}:${row.revision}`;
    if (query.revision && query.revision !== revision) throw new ConflictException({ code: 'PROJECT_LIST_CHANGED', message: '项目列表已变化，请刷新列表' });
    const items: ProjectHistoryItem[] = row.items.map(item => ({ kind: item.kind as ProjectHistoryItem['kind'], id: String(item.id),
      title: String(item.title), subtitle: String(item.subtitle), tags: item.tags as string[], status: item.status as ProjectHistoryItem['status'],
      templateVersionId: String(item.template_version_id), currentStageIndex: Number(item.current_stage_index), stageTotal: Number(item.stage_total),
      progressPercent: Number(item.progress_percent), createdAt: new Date(String(item.created_at)).toISOString(), lastLearningActivityAt: null,
      collectedAt: item.collected_at ? new Date(String(item.collected_at)).toISOString() : null, isCurrent: item.id === row.current_project_id }));
    return { items, revision, counts: { active: row.active, draft: row.draft, done: row.done }, version: row.version,
      currentProjectId: row.current_project_id, recommendedProjectId: row.recommended_project_id,
      paginationKeys:Object.fromEntries(row.items.map(item=>[`${item.kind}:${item.id}`,String(item.created_at)])) };
  }

  async change(studentId: string, projectId: string | null, input: ProjectDisplayChange,commit?: (tx:AuditTransaction)=>Promise<void>) {
    return this.db.transaction(async tx => {
      await tx.insert(studentProjectLists).values({ studentUserId: studentId }).onConflictDoNothing();
      const [head] = await tx.select().from(studentProjectLists).where(eq(studentProjectLists.studentUserId, studentId)).for('update');
      if (head!.version !== input.expectedVersion) throw new ConflictException({ code: 'PROJECT_PREFERENCE_CHANGED', message: '显示偏好已变化，请重新读取' });
      if (projectId) {
        const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.studentUserId, studentId))).for('update');
        if (!project) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '项目不可用' });
      }
      let priorSelection = head!.currentProjectId;
      if (priorSelection) {
        const [prior] = await tx.select().from(projects).where(and(eq(projects.id,priorSelection),eq(projects.studentUserId,studentId))).for('update');
        if (!prior || ['completed','published','exploration'].includes(prior.status)) priorSelection = null;
      }
      const currentProjectId = input.currentProjectId === undefined ? priorSelection : input.currentProjectId;
      if (projectId && input.collected && priorSelection === projectId && input.currentProjectId === undefined) {
        throw new ConflictException({ code: 'PROJECT_SELECTION_REQUIRED', message: '请明确选择其他继续学习项目或清空当前选择' });
      }
      if (currentProjectId) {
        const [target] = await tx.select().from(projects).where(and(eq(projects.id, currentProjectId), eq(projects.studentUserId, studentId))).for('update');
        const [display] = await tx.select().from(studentProjectDisplay).where(and(eq(studentProjectDisplay.projectId,currentProjectId),eq(studentProjectDisplay.studentUserId,studentId)));
        if (!target || ['completed','published','exploration'].includes(target.status) || display?.collectedAt || input.collected && projectId === currentProjectId) {
          throw new ConflictException({ code: 'PROJECT_SELECTION_UNAVAILABLE', message: '所选项目不能继续学习，请先恢复显示或选择其他项目' });
        }
      }
      const collectedAt = input.collected === true ? new Date() : null;
      if (projectId && input.collected !== undefined) await tx.insert(studentProjectDisplay).values({ studentUserId: studentId, projectId, collectedAt })
        .onConflictDoUpdate({ target: [studentProjectDisplay.studentUserId, studentProjectDisplay.projectId], set: { collectedAt } });
      const [saved] = await tx.update(studentProjectLists).set({ currentProjectId, version: head!.version + 1 }).where(eq(studentProjectLists.studentUserId, studentId)).returning();
      await commit?.(tx);
      return { version: saved!.version, currentProjectId: saved!.currentProjectId, collectedAt: collectedAt?.toISOString() ?? null };
    });
  }
}
