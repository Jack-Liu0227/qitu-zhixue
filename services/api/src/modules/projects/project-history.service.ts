import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CurrentUser, ProjectDisplayChange, ProjectHistoryPage } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashRequest } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { ProjectHistoryStore, type ProjectHistoryQuery } from './project-history.store';
import { ProjectCoversService } from './project-covers.service';

type Cursor = { studentId: string; filters: string; revision: string; after: NonNullable<ProjectHistoryQuery['after']>; expires: number };

@Injectable()
export class ProjectHistoryService {
  // Like the current auth sessions, cursors are scoped to this API process. Restart requires refresh.
  private readonly signingKey = randomBytes(32);
  constructor(@Inject(ProjectHistoryStore) private readonly store: ProjectHistoryStore | null,
    private readonly projects: LearningPlanStore, private readonly idempotency: IdempotencyStore, private readonly audit: AuditWriter,
    @Optional() private readonly covers?: ProjectCoversService) {}
  private owner(actor: CurrentUser) {
    if (actor.role !== 'student') throw new ForbiddenException({ code: 'PROJECT_HISTORY_FORBIDDEN', message: '仅学生本人可管理项目入口' });
    if (!this.store) throw new ServiceUnavailableException({ code: 'PROJECT_HISTORY_UNAVAILABLE', message: '项目历史存储暂不可用' });
    return this.store;
  }
  private sign(encoded: string) { return createHmac('sha256', this.signingKey).update(encoded).digest('base64url'); }
  async currentSelection(studentId: string): Promise<string | null> {
    if (!this.store) throw new ServiceUnavailableException({ code:'PROJECT_HISTORY_UNAVAILABLE',message:'项目入口偏好暂不可用' });
    const snapshot = await this.store.query(studentId,{ tab:'active',q:'',includeCollected:false,limit:1 });
    const id = snapshot.currentProjectId ?? (snapshot.version === 0 ? snapshot.recommendedProjectId : null);
    if (!id) return null;
    const project = await this.projects.findProject(id);
    return project?.studentId === studentId && !['completed','published','exploration'].includes(project.status) ? id : null;
  }
  async query(actor: CurrentUser, raw: Record<string, unknown>): Promise<ProjectHistoryPage> {
    const store = this.owner(actor);
    const tab = raw.tab ?? 'active';
    const limit = raw.limit === undefined ? 20 : Number(raw.limit);
    if (!['active','draft','done','all'].includes(String(tab)) || typeof tab !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 50
      || raw.limit !== undefined && (typeof raw.limit !== 'string' || !/^[1-9]\d?$/.test(raw.limit))
      || raw.q !== undefined && (typeof raw.q !== 'string' || raw.q.length > 120)
      || raw.includeCollected !== undefined && (typeof raw.includeCollected !== 'string' || !['true','false'].includes(raw.includeCollected))) this.invalid();
    const query: ProjectHistoryQuery = { tab: tab as ProjectHistoryQuery['tab'], q: typeof raw.q === 'string' ? raw.q.trim() : '', limit,
      includeCollected: raw.includeCollected === 'true' };
    const filters = JSON.stringify([query.tab,query.q,query.includeCollected,limit]);
    if (raw.cursor !== undefined) {
      if (typeof raw.cursor !== 'string' || raw.cursor.length > 2500) this.invalid();
      const [encoded, signature, extra] = raw.cursor.split('.');
      const expected = this.sign(encoded ?? '');
      if (!encoded || !signature || extra || !/^[A-Za-z0-9_-]{43}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) this.invalid();
      let cursor: Cursor;
      try { cursor = JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')) as Cursor; } catch { this.invalid(); }
      if (cursor!.studentId !== actor.id || cursor!.filters !== filters || cursor!.expires < Date.now() || !cursor!.after
        || !Number.isFinite(Date.parse(cursor!.after.createdAt)) || typeof cursor!.after.id !== 'string'
        || !['project','exploration','plan'].includes(cursor!.after.kind)) this.invalid();
      query.after = cursor!.after; query.revision = cursor!.revision;
    }
    const snapshot = await store.query(actor.id, query);
    let currentProjectId = snapshot.currentProjectId ?? (snapshot.version === 0 ? snapshot.recommendedProjectId : null);
    if (currentProjectId) {
      const project = await this.projects.findProject(currentProjectId);
      if (!project || project.studentId !== actor.id || ['completed','published','exploration'].includes(project.status)) currentProjectId = null;
    }
    const baseItems = snapshot.items.slice(0,limit).map(item => ({ ...item, isCurrent: item.kind === 'project' && item.id === currentProjectId }));
    const items = this.covers ? await this.covers.decorate(baseItems) : baseItems;
    const last = items.at(-1);
    let nextCursor: string | null = null;
    if (snapshot.items.length > limit && last) {
      const encoded = Buffer.from(JSON.stringify({ studentId: actor.id, filters, revision: snapshot.revision,
        after: { createdAt: snapshot.paginationKeys[`${last.kind}:${last.id}`] ?? last.createdAt, id: last.id, kind: last.kind }, expires: Date.now() + 15*60_000 } satisfies Cursor)).toString('base64url');
      nextCursor = `${encoded}.${this.sign(encoded)}`;
    }
    return { items, nextCursor, counts: snapshot.counts, revision: snapshot.revision, preferenceVersion: snapshot.version,
      currentProjectId, selectionSource: !currentProjectId ? 'none' : snapshot.currentProjectId ? 'explicit' : 'creation_fallback' };
  }
  private invalid(): never { throw new BadRequestException({ code: 'PROJECT_QUERY_INVALID', message: '项目查询参数无效，请刷新列表' }); }

  async change(actor: CurrentUser, projectId: string | null, raw: unknown, key: string | undefined) {
    const store = this.owner(actor);
    if (!key?.trim() || key.length > 160 || !raw || typeof raw !== 'object' || Array.isArray(raw)) this.invalid();
    const body = raw as Record<string, unknown>;
    if (Object.keys(body).some(name => !['expectedVersion','collected','currentProjectId'].includes(name))
      || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0
      || projectId && typeof body.collected !== 'boolean'
      || !projectId && (!Object.hasOwn(body,'currentProjectId') || body.collected !== undefined)
      || body.currentProjectId !== undefined && body.currentProjectId !== null && (typeof body.currentProjectId !== 'string' || !body.currentProjectId.trim() || body.currentProjectId.length > 200)) this.invalid();
    const input = body as unknown as ProjectDisplayChange;
    // Object ownership is checked on every request, including cached idempotent replays.
    for (const id of [projectId,input.currentProjectId].filter((value): value is string => typeof value === 'string')) {
      const project = await this.projects.findProject(id);
      if (!project || project.studentId !== actor.id) throw new ForbiddenException({ code: 'PROJECT_HISTORY_FORBIDDEN', message: '无权管理该项目入口' });
    }
    const result = await this.idempotency.execute(`project.display:${actor.id}`, key!, hashRequest({ projectId,input }), async () => {
      const before = await store.query(actor.id,{ tab:'all',q:'',includeCollected:true,limit:1 });
      if (before.version !== input.expectedVersion) throw new ConflictException({ code: 'PROJECT_PREFERENCE_CHANGED', message: '显示偏好已变化，请刷新' });
      const effective = before.version === 0 && input.currentProjectId === undefined
        ? { ...input, currentProjectId: before.currentProjectId ?? before.recommendedProjectId } : input;
      const saved = await store.change(actor.id,projectId,effective,async tx => {
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'project.display.changed', targetType:'student',targetId:actor.id,
          idempotencyKey: key!, detail: { projectId,expectedVersion:input.expectedVersion,collected:input.collected,currentProjectId:effective.currentProjectId } },tx);
      });
      return { status:200,body:saved };
    }).catch(throwHttpForIdempotencyError);
    const readback = await store.query(actor.id,{ tab:'all',q:'',includeCollected:true,limit:1 });
    return { ...result.body, replayed:result.replayed, currentVersion:readback.version, superseded:readback.version !== result.body.version };
  }
}
