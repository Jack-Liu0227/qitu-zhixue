import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { CoursewareContent, CoursewareInstance, CoursewareSource, CoursewareUse, CoursewareVersion, CurrentUser, CoursewareGeneration, CoursewareFeedbackKind } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { buildActivityBoard } from '../../common/tutor-runtime/board-content';
import { CoursewareStore } from './courseware.store';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uses = ['explain', 'demonstrate', 'remediate', 'review'];
const authored: CoursewareGeneration = { policyVersion: 'courseware.v1', rendererVersion: 'board.v1', modelProviderId: null, modelId: null, skillDigests: [] };
export function coursewareError(code: string, message: string): never { throw new ConflictException({ code, message }); }
export function coursewareObject(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !keys.includes(k))) {
    throw new BadRequestException({ code: 'COURSEWARE_INVALID', message: '课件参数无效。' });
  }
  return raw as Record<string, unknown>;
}
function bounded(value: unknown, limit: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= limit; }
function content(raw: unknown): CoursewareContent {
  const value = coursewareObject(raw, ['title', 'steps']);
  buildActivityBoard({ kind: 'board', ...value }, 'validation');
  return structuredClone(value) as unknown as CoursewareContent;
}
function sources(raw: unknown): CoursewareSource[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 8) throw new BadRequestException('需要一至八条核验来源');
  return raw.map(item => {
    const v = coursewareObject(item, ['knowledgeBaseId', 'documentRefHash', 'title']);
    if (!bounded(v.knowledgeBaseId, 200) || !bounded(v.title, 200) || typeof v.documentRefHash !== 'string' || !/^[a-f0-9]{64}$/u.test(v.documentRefHash)) {
      throw new BadRequestException({ code: 'COURSEWARE_SOURCE_REQUIRED', message: '来源必须包含知识库、文档校验值与标题。' });
    }
    return { knowledgeBaseId: v.knowledgeBaseId, documentRefHash: v.documentRefHash, title: v.title };
  });
}
function refs(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 8 || raw.some(v => !bounded(v, 160) || !/^[a-zA-Z0-9._-]+$/u.test(v)) || new Set(raw).size !== raw.length) {
    throw new BadRequestException({ code: 'COURSEWARE_OBJECTIVES_INVALID', message: '请选择稳定的课程目标，不使用学生计划中的实例目标。' });
  }
  return raw;
}
function admin(actor: CurrentUser) { if (actor.role !== 'admin') throw new ForbiddenException({ code: 'COURSEWARE_ADMIN_REQUIRED', message: '课件审核与发布仅向管理员开放。' }); }
function sameSources(required: readonly CoursewareSource[], actual: readonly CoursewareSource[]) {
  return required.every(source => actual.some(v => v.knowledgeBaseId === source.knowledgeBaseId && v.documentRefHash === source.documentRefHash));
}

export interface CaptureCourseware {
  actor: CurrentUser;
  scope: Pick<CoursewareInstance, 'projectId' | 'planId' | 'planRevision' | 'learningSessionId' | 'activityId'>;
  content: CoursewareContent;
  objectiveRefs: string[];
  sources: CoursewareSource[];
  curriculumHash: string;
  generation?: CoursewareGeneration;
  use?: CoursewareUse;
  assetVersionId?: string;
  parentVersionId?: string;
  key: string;
}

/** Knowledge owns reusable content. Callers must prove live project scope before capture/read. */
@Injectable()
export class CoursewareService {
  constructor(private readonly store: CoursewareStore, private readonly audit: AuditWriter) {}

  async list(actor: CurrentUser) { admin(actor); return this.store.versions(); }

  async deliveredObjectives(scope: CaptureCourseware['scope'], curriculumHash: string): Promise<string[]> {
    const instances = await this.store.instances(scope.projectId, scope.planId, scope.planRevision, scope.learningSessionId);
    return [...new Set(instances.filter(instance => instance.activityId === scope.activityId
      && instance.curriculumHash === curriculumHash && instance.acknowledgedAt !== null).flatMap(instance => instance.objectiveRefs))];
  }

  async create(actor: CurrentUser, raw: unknown, key: string): Promise<CoursewareVersion> {
    admin(actor);
    const value = coursewareObject(raw, ['content', 'objectiveRefs', 'use', 'sources', 'parentVersionId', 'changeSummary', 'curriculumHash']);
    const parsed = { content: content(value.content), objectiveRefs: refs(value.objectiveRefs), sources: sources(value.sources) };
    if (typeof value.curriculumHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.curriculumHash)
      || !uses.includes(String(value.use)) || !bounded(value.changeSummary, 500)
      || value.parentVersionId !== undefined && !bounded(value.parentVersionId, 160)) throw new BadRequestException('需要用途与有界修订说明');
    return this.mutate(actor, 'create', key, value, async store => {
      const parent = value.parentVersionId ? await store.version(String(value.parentVersionId)) : null;
      if (value.parentVersionId && !parent) throw new NotFoundException('父课件版本不存在');
      if (parent && !sameSources(parent.sources, parsed.sources)) coursewareError('COURSEWARE_SOURCE_LINEAGE_REQUIRED', '改编必须保留父版本的来源。');
      if (parent && parent.curriculumHash !== value.curriculumHash) coursewareError('COURSEWARE_CURRICULUM_MISMATCH', '修订需保留课程版本。');
      const now = new Date().toISOString();
      const version: CoursewareVersion = { ...parsed, assetId: parent?.assetId ?? `cwa-${randomUUID()}`,
        versionId: `cwv-${randomUUID()}`, parentVersionId: parent?.versionId ?? null, revision: 1,
        status: 'candidate', contentHash: digest(parsed.content), curriculumHash: String(value.curriculumHash), generation: authored, use: value.use as CoursewareUse,
        changeSummary: String(value.changeSummary), review: null, createdAt: now, updatedAt: now };
      await store.saveVersion(version);
      return version;
    });
  }

  async review(actor: CurrentUser, id: string, raw: unknown, key: string): Promise<CoursewareVersion> {
    admin(actor);
    const value = coursewareObject(raw, ['expectedRevision', 'status', 'review']);
    if (!Number.isSafeInteger(value.expectedRevision) || !['published', 'withdrawn'].includes(String(value.status))) throw new BadRequestException('审核版本或状态无效');
    const review = coursewareObject(value.review, ['scientific', 'teaching', 'rendering', 'privacy', 'rights', 'note']);
    if (!bounded(review.note, 1000) || ['scientific', 'teaching', 'rendering', 'privacy', 'rights'].some(k => typeof review[k] !== 'boolean')) throw new BadRequestException('请填写逐项审核和说明');
    if (value.status === 'published' && ['scientific', 'teaching', 'rendering', 'privacy', 'rights'].some(k => review[k] !== true)) {
      coursewareError('COURSEWARE_REVIEW_INCOMPLETE', '科学、教学、渲染、隐私与来源许可审核全部通过后才能发布。');
    }
    return this.mutate(actor, `review:${id}`, key, value, async store => {
      const current = await store.version(id);
      if (!current) throw new NotFoundException('课件版本不存在');
      if (current.revision !== value.expectedRevision) coursewareError('COURSEWARE_REVISION_CONFLICT', '课件状态已变化，请刷新。');
      if (value.status === 'published' && current.status !== 'candidate') coursewareError('COURSEWARE_IMMUTABLE', '已发布或撤回内容须创建新版本后重新审核。');
      const next: CoursewareVersion = { ...current, status: value.status as 'published' | 'withdrawn', revision: current.revision + 1,
        review: review as unknown as NonNullable<CoursewareVersion['review']>, updatedAt: new Date().toISOString() };
      await store.saveVersion(next);
      return next;
    });
  }

  /** Scope-filter before returning even titles; the model gets no original project/user identity. */
  async find(objectiveRefs: readonly string[], allowedLibraries: readonly string[], use: CoursewareUse, curriculumHash: string) {
    return (await this.store.versions('published')).filter(v => v.use === use && v.curriculumHash === curriculumHash
      && v.sources.every(source => allowedLibraries.includes(source.knowledgeBaseId))
      && v.objectiveRefs.every(ref => objectiveRefs.includes(ref))).slice(0, 8)
      .map(v => ({ versionId: v.versionId, title: v.content.title, objectiveRefs: v.objectiveRefs, sources: v.sources, contentHash: v.contentHash }));
  }

  async reuse(id: string, objectiveRefs: readonly string[], verified: readonly CoursewareSource[], curriculumHash: string) {
    const value = await this.store.version(id);
    if (!value || value.status !== 'published' || value.curriculumHash !== curriculumHash || !value.objectiveRefs.every(ref => objectiveRefs.includes(ref))
      || !sameSources(value.sources, verified)) coursewareError('COURSEWARE_NOT_AUTHORIZED', '课件已撤回、不适用于当前目标或来源未重新核验。');
    return value;
  }

  async assertInstanceAvailable(instance: CoursewareInstance, store: CoursewareStore = this.store) {
    for (const id of [instance.assetVersionId, instance.parentVersionId]) {
      if (id && (await store.version(id))?.status !== 'published') coursewareError('COURSEWARE_WITHDRAWN', '课件来源版本已撤回，请重新准备。');
    }
    if (instance.candidateVersionId && (await store.version(instance.candidateVersionId))?.status === 'withdrawn') {
      coursewareError('COURSEWARE_WITHDRAWN', '此课件已撤回，请重新准备。');
    }
  }

  async capture(input: CaptureCourseware): Promise<CoursewareInstance> {
    if (input.actor.role !== 'student') throw new ForbiddenException('只有学生本人可产生课堂展示记录');
    if (!/^[a-f0-9]{64}$/u.test(input.curriculumHash) || !bounded(input.key, 400)) throw new BadRequestException('需要课程版本和操作标识。');
    const use = input.use ?? 'explain';
    if (!uses.includes(use)) throw new BadRequestException('课件用途无效。');
    const parsed = { content: content(input.content), sources: sources(input.sources), objectiveRefs: refs(input.objectiveRefs), curriculumHash: input.curriculumHash };
    const id = `cwi-${digest([input.actor.id, input.scope, input.key]).slice(0, 40)}`;
    const hash = digest({ ...parsed, ...(use !== 'explain' ? { use } : {}), scope: input.scope, assetVersionId: input.assetVersionId ?? null, parentVersionId: input.parentVersionId ?? null });
    return this.store.transaction(async store => {
      const existing = await store.instance(id);
      if (existing) {
        if (existing.hash !== hash) coursewareError('IDEMPOTENCY_KEY_CONFLICT', '同一课件请求不能改变内容。');
        await this.assertInstanceAvailable(existing.value, store);
        return existing.value;
      }
      const versionId = input.assetVersionId ?? input.parentVersionId;
      if (versionId) {
        const version = await store.version(versionId);
        if (!version || version.status !== 'published' || version.curriculumHash !== input.curriculumHash || !sameSources(version.sources, parsed.sources)
          || !version.objectiveRefs.every(ref => parsed.objectiveRefs.includes(ref))) coursewareError('COURSEWARE_NOT_AUTHORIZED', '课件来源或版本已变化。');
        if (input.assetVersionId && digest(parsed.content) !== version.contentHash) coursewareError('COURSEWARE_CONTENT_MISMATCH', '复用内容与发布版本不一致。');
      }
      const candidateId = input.assetVersionId ? null : `cwv-${digest([parsed, input.parentVersionId ?? null, ...(use !== 'explain' ? [use] : [])]).slice(0, 40)}`;
      const value: CoursewareInstance = { ...input.scope, ...parsed, id, contentHash: digest(parsed.content),
        generation: input.generation ?? authored, candidateVersionId: candidateId,
        assetVersionId: input.assetVersionId ?? null, parentVersionId: input.parentVersionId ?? null,
        createdAt: new Date().toISOString(), acknowledgedAt: null, position: 0 };
      await store.saveInstance(value, hash);
      if (candidateId) {
        if (!await store.version(candidateId)) {
          const parent = input.parentVersionId ? await store.version(input.parentVersionId) : null;
          // Only teaching content is nominated. No project, learner, conversation or answer metadata is copied.
          await store.saveVersion({ ...parsed, assetId: parent?.assetId ?? `cwa-${randomUUID()}`, versionId: candidateId,
            parentVersionId: parent?.versionId ?? null, revision: 1, status: 'candidate', contentHash: value.contentHash,
            generation: value.generation, use, changeSummary: '教学课件候选，待管理员审核科学性、教学适配、隐私和来源使用范围。',
            review: null, createdAt: value.createdAt, updatedAt: value.createdAt });
        }
      }
      await this.audit.write({ actorId: input.actor.id, actorRole: input.actor.role, action: 'courseware.delivered',
        targetType: 'courseware_instance', targetId: id, idempotencyKey: id,
        detail: { projectId: value.projectId, contentHash: value.contentHash, sourceCount: value.sources.length } }, store.auditTransaction());
      return value;
    });
  }

  async acknowledge(actor: CurrentUser, instance: CoursewareInstance, position: number, continueLearning: boolean, key: string) {
    if (actor.role !== 'student') throw new ForbiddenException('只有学生本人可保存课件位置');
    if (!Number.isSafeInteger(position) || position < 0 || position >= instance.content.steps.length) throw new BadRequestException('课件位置无效');
    return this.mutate(actor, `position:${instance.id}`, key, { position, continueLearning }, async store => {
      const current = await store.instance(instance.id);
      if (!current) throw new NotFoundException('课件不存在');
      await this.assertInstanceAvailable(current.value, store);
      const value = { ...current.value, position, acknowledgedAt: continueLearning ? current.value.acknowledgedAt ?? new Date().toISOString() : current.value.acknowledgedAt };
      await store.saveInstance(value, current.hash);
      return value;
    }, instance.projectId);
  }

  async feedback(actor: CurrentUser, instance: CoursewareInstance, kind: CoursewareFeedbackKind, key: string) {
    if (actor.role !== 'student' || !['science', 'match', 'understanding', 'rendering', 'suggestion'].includes(kind)) throw new BadRequestException('反馈类别无效。');
    return this.mutate(actor, `feedback:${instance.id}`, key, { kind }, async store => {
      const current = await store.instance(instance.id);
      if (!current) throw new NotFoundException('课件不存在');
      if (current.value.feedback?.includes(kind)) return current.value;
      const value = { ...current.value, feedback: [...current.value.feedback ?? [], kind] };
      await store.saveInstance(value, current.hash);
      const version = await store.version(value.assetVersionId ?? value.candidateVersionId ?? '');
      if (version) await store.saveVersion({ ...version, revision: version.revision + 1, updatedAt: new Date().toISOString(),
        feedbackCounts: { ...version.feedbackCounts, [kind]: (version.feedbackCounts?.[kind] ?? 0) + 1 } });
      return value;
    }, instance.projectId);
  }

  private async mutate<T>(actor: CurrentUser, operation: string, key: string, input: unknown, work: (store: CoursewareStore) => Promise<T>, projectId?: string): Promise<T> {
    if (!bounded(key, 200)) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '请使用稳定的操作标识重试。' });
    const id = `courseware:${digest([actor.id, operation, key])}`, hash = digest(input);
    return this.store.transaction(async store => {
      const replay = await store.operation(id);
      if (replay) {
        if (replay.hash !== hash) coursewareError('IDEMPOTENCY_KEY_CONFLICT', '操作标识已用于不同内容。');
        return replay.response as T;
      }
      const result = await work(store);
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'courseware.' + operation.split(':')[0],
        targetType: 'courseware', targetId: id, idempotencyKey: id, detail: { operation, requestHash: hash } }, store.auditTransaction());
      await store.saveOperation(id, { hash, response: result, projectId });
      return result;
    });
  }
}
