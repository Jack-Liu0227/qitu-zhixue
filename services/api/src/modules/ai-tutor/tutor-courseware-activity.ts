import { ConflictException } from '@nestjs/common';
import type { CoursewareContent, CoursewareSource, CoursewareUse, TutorReplyBlock } from '@qitu/contracts';
import type { CoursewareService } from '../knowledge/courseware.service';
import { coursewareObject } from '../knowledge/courseware.service';
import type { TutorTeachingContext } from './tutor-teaching-context';
import type { LessonActivityScope } from './tutor-lesson-activity';
import type { ImaReadEvidence } from './ima-project-scope';
import { buildActivityBoard } from '../../common/tutor-runtime/board-content';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';

export interface CoursewareActivityPort {
  execute(candidate: Record<string, unknown>, key: string): Promise<{ block?: TutorReplyBlock; text: string }>;
}
export function frozenTeachingSpec(teaching: TutorTeachingContext) {
  return teaching.bundle.template.curriculum?.profiles.find(p => p.id === teaching.bundle.scheduleProfileId)
    ?.sessions.find(s => s.sessionIndex === teaching.session.lessonIndex)?.teachingSpec;
}
export function coursewareSources(evidence: readonly ImaReadEvidence[]): CoursewareSource[] {
  return evidence.map(source => ({ knowledgeBaseId: source.knowledgeBaseId, documentRefHash: source.documentRefHash,
    title: source.title?.slice(0, 200) || '授权教学资料' }));
}
export function createCoursewareActivityPort(input: {
  service: CoursewareService; teaching: TutorTeachingContext; scope: LessonActivityScope; studentId: string;
  verify(refs: readonly string[]): Promise<readonly ImaReadEvidence[]>;
  allowedLibraries(): Promise<readonly string[]>;
}): CoursewareActivityPort {
  const spec = frozenTeachingSpec(input.teaching)!;
  const objectives = spec.concepts.map(c => c.objectiveId);
  const curriculumHash = teachingValueDigest(input.teaching.bundle.template);
  function fail(code = 'COURSEWARE_NOT_AUTHORIZED'): never { throw new ConflictException({ code, message: '课件目标、来源或当前活动不匹配。' }); }
  return { async execute(candidate, key) {
    if (!input.scope.activityId) fail('COURSEWARE_ACTIVITY_REQUIRED');
    const delivered = new Set(await input.service.deliveredObjectives({ ...input.scope, activityId: input.scope.activityId }, curriculumHash));
    const remainingConcepts = spec.concepts.filter(concept => !delivered.has(concept.objectiveId));
    if (candidate.kind === 'find_courseware') {
      coursewareObject(candidate, ['kind', 'use']);
      if (!['explain', 'demonstrate', 'remediate', 'review'].includes(String(candidate.use))) fail();
      const found = await input.service.find(objectives, await input.allowedLibraries(), candidate.use as CoursewareUse, curriculumHash);
      return { text: JSON.stringify({ assets: found, remainingConcepts,
        instruction: 'These remaining concepts have no acknowledged delivery in the current activity. Teach them next, one concept or a coherent group per board. Read sources in the current scope and copy actual evidence_ref values into sourceRefs before reuse. No match: generate a bounded source-grounded board. Acknowledged delivery is not mastery.' }) };
    }
    // The published model schema also permits presentation metadata. Validate it here;
    // capture below receives only content and server-verified scope/evidence.
    if (candidate.kind === 'board') {
      if (candidate.use !== undefined && !['explain', 'demonstrate', 'remediate', 'review'].includes(String(candidate.use))) fail();
      if (candidate.summary !== undefined && (typeof candidate.summary !== 'string' || candidate.summary.length > 500)) fail();
    }
    coursewareObject(candidate, ['kind', 'title', 'steps', 'origin', 'sourceRefs', 'objectiveRefs', 'assetVersionId', 'parentVersionId',
      ...(candidate.kind === 'board' ? ['use', 'summary'] : [])]);
    if (!Array.isArray(candidate.sourceRefs) || !candidate.sourceRefs.length || candidate.sourceRefs.some(v => typeof v !== 'string')) fail('COURSEWARE_SOURCE_REQUIRED');
    const verified = await input.verify(candidate.sourceRefs as string[]);
    if (verified.some(source => !source.sourceRef.startsWith('knowledge-read:') && !source.sourceRef.startsWith('ima-read:'))) fail('COURSEWARE_READ_REQUIRED');
    const sources = coursewareSources(verified);
    let content: CoursewareContent, refs: string[];
    let use: CoursewareUse = candidate.kind === 'board' && candidate.use ? candidate.use as CoursewareUse : 'explain';
    let assetVersionId: string | undefined;
    if (candidate.kind === 'reuse_courseware') {
      if (typeof candidate.assetVersionId !== 'string' || candidate.parentVersionId !== undefined || candidate.steps !== undefined) fail();
      const asset = await input.service.reuse(candidate.assetVersionId, objectives, sources, curriculumHash);
      content = asset.content; refs = [...asset.objectiveRefs]; assetVersionId = asset.versionId;
      use = asset.use;
    } else {
      if (candidate.kind !== 'board' || candidate.assetVersionId !== undefined
        || !Array.isArray(candidate.objectiveRefs) || !candidate.objectiveRefs.length
        || candidate.objectiveRefs.some(ref => typeof ref !== 'string' || !objectives.includes(ref))) fail('COURSEWARE_OBJECTIVES_INVALID');
      if (candidate.parentVersionId !== undefined && typeof candidate.parentVersionId !== 'string') fail();
      content = { title: candidate.title as string, steps: candidate.steps as CoursewareContent['steps'] };
      refs = candidate.objectiveRefs as string[];
    }
    if (use !== 'remediate' && remainingConcepts.length && refs.every(ref => delivered.has(ref))) return { text: JSON.stringify({ remainingConcepts,
      instruction: 'This board repeats only concepts already delivered in this activity. Nothing new was saved. Teach a remaining concept with verified sources before continuing.' }) };
    const instance = await input.service.capture({ actor: { id: input.studentId, role: 'student', email: '', displayName: '' },
      scope: { projectId: input.scope.projectId, planId: input.scope.planId, planRevision: input.scope.planRevision,
        learningSessionId: input.scope.learningSessionId, activityId: input.scope.activityId }, content, objectiveRefs: refs, sources, use,
      curriculumHash, generation: { policyVersion: 'courseware.v1', rendererVersion: 'board.v1',
        modelProviderId: input.teaching.role.modelByPurpose.dialogue?.modelProviderId ?? null,
        modelId: input.teaching.role.modelByPurpose.dialogue?.modelId ?? null,
        skillDigests: input.teaching.role.skills.map(skill => ({ canonicalId: skill.canonicalId, version: skill.version, packageDigest: skill.packageDigest })) },
      assetVersionId, parentVersionId: candidate.parentVersionId as string | undefined, key });
    return { block: { ...buildActivityBoard({ kind: 'board', ...instance.content }, instance.id), provenance: {
      origin: assetVersionId || candidate.parentVersionId ? 'adapted' : 'generated',
      sources: verified.map(source => ({ sourceRef: source.sourceRef, title: source.title || '授权教学资料' })),
    } }, text: `Courseware saved (${instance.id}). Guide observation step by step. The student can restore it and continue from the lesson panel. Continuing confirms delivery only; never claim mastery.` };
  } };
}
