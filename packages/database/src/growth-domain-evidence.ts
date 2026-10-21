import { and, desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type {
  DomainProjectionEvidence, GrowthDomainKind, GrowthDomainObservation, GrowthProjectionType, ProjectStage,
} from '@qitu/contracts' with { 'resolution-mode': 'import' };
import type { Database } from './client';
import {
  adminTeamVersions, agentConfigs, agentProjectionCandidates, agentTeamEvents, agentTeamRuns,
  artifacts, artifactVersions, learningObjectives, learningPlans, learningSessions, masteryEvents,
  masteryRecords, mentorAssignments, mentorReviews, outbox, pblTemplateTeamBindings,
  projectBindingSnapshots, projectEvidence, projects,
} from './schema/index';

type Reader = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
type Source = { kind: GrowthDomainKind; sourceId: string };
type Fact = Omit<GrowthDomainObservation, 'sourceHash' | 'sourceAgentId' | 'studentId' | 'projectId' | 'projectTitle'> & {
  studentId: string; projectId: string;
};
const STAGES: readonly ProjectStage[] = ['exploration', 'intent_confirmed', 'theory_learning', 'theory_check',
  'practice_ready', 'practice_building', 'artifact_review', 'reflection', 'published', 'completed'];

export function growthDomainEventId(source: Source & { sourceHash: string }): string {
  return `growth-domain-${digest(JSON.stringify([source.kind, source.sourceId, source.sourceHash]))}`;
}

/** Reads existing owner stores; no mutation, score recomputation, transcript or report body is returned. */
export async function readGrowthDomainObservation(db: Reader, source: Source): Promise<GrowthDomainObservation> {
  const fact = source.kind === 'project_transition' ? await transitionFact(db, source)
    : source.kind === 'published_artifact' ? await publicationFact(db, source)
      : source.kind === 'reflection' ? await reflectionFact(db, source) : await masteryFact(db, source);
  const [project] = await db.select().from(projects).where(eq(projects.id, fact.projectId)).limit(1);
  if (!project || project.studentUserId !== fact.studentId || !project.templateVersionId) fail('PROJECTION_OWNER_INVALID');
  const [snapshot] = await db.select().from(projectBindingSnapshots).where(eq(projectBindingSnapshots.projectId, project.id)).limit(1);
  if (!snapshot || snapshot.backfilled || snapshot.templateVersionId !== project.templateVersionId) fail('PROJECTION_FROZEN_BINDING_REQUIRED');
  const [binding] = await db.select().from(pblTemplateTeamBindings).where(eq(pblTemplateTeamBindings.id, snapshot.bindingId)).limit(1);
  const [team] = await db.select().from(adminTeamVersions).where(eq(adminTeamVersions.id, snapshot.teamVersionId)).limit(1);
  if (!binding || !team || !team.enabled || binding.templateVersionId !== snapshot.templateVersionId
    || binding.teamVersionId !== snapshot.teamVersionId || binding.bindingHash !== snapshot.bindingHash
    || (binding.bundleDigest ?? null) !== (snapshot.bundleDigest ?? null)) fail('PROJECTION_FROZEN_BINDING_REQUIRED');
  const [leader] = await db.select().from(agentConfigs).where(eq(agentConfigs.id, team.leaderAssistantId)).limit(1);
  if (!leader?.enabled) fail('PROJECTION_SOURCE_AGENT_UNAVAILABLE');
  const observation = { ...fact, projectTitle: project.title.slice(0, 160), sourceAgentId: team.leaderAssistantId };
  return { ...observation, sourceHash: digest(JSON.stringify({ kind: fact.kind, sourceId: fact.sourceId,
    studentId: fact.studentId, projectId: fact.projectId, occurredAt: fact.occurredAt, topic: fact.topic,
    type: fact.type, stage: fact.stage, artifactRef: fact.artifactRef, objectiveTitles: fact.objectiveTitles,
    evidenceRefs: fact.evidenceRefs, sourceAgentId: team.leaderAssistantId, bindingHash: snapshot.bindingHash })) };
}

/** Both executor and Growth owner independently reconstruct and bind the same bounded evidence. */
export async function readDomainProjectionEvidence(db: Reader, input: {
  sourceEventId: string; runId: string; studentId: string; projectId: string | null; projectionType: GrowthProjectionType;
}): Promise<DomainProjectionEvidence> {
  const { DOMAIN_OBSERVATION_POLICY, validateGrowthProjectionResult } = await import('@qitu/contracts');
  const [event] = await db.select().from(agentTeamEvents).where(eq(agentTeamEvents.id, input.sourceEventId)).limit(1);
  const payload = event?.payload;
  if (!event || !payload || !isKind(payload.domainKind) || typeof payload.domainSourceId !== 'string'
    || typeof payload.domainSourceHash !== 'string' || payload.studentUserId !== input.studentId
    || payload.projectId !== input.projectId) fail('PROJECTION_SOURCE_INVALID');
  const observation = await readGrowthDomainObservation(db, { kind: payload.domainKind, sourceId: payload.domainSourceId });
  if (observation.studentId !== input.studentId || observation.projectId !== input.projectId
    || event.topic !== observation.topic || payload.domainSourceHash !== observation.sourceHash
    || payload.sourceAgentId !== observation.sourceAgentId
    || event.id !== growthDomainEventId(observation)
    || JSON.stringify(payload.evidenceRefs) !== JSON.stringify(observation.evidenceRefs)) fail('PROJECTION_SOURCE_INVALID');
  const [run] = await db.select().from(agentTeamRuns).where(eq(agentTeamRuns.id, input.runId)).limit(1);
  if (!run || run.studentUserId !== input.studentId || run.projectId !== input.projectId
    || run.leaderAgentId !== observation.sourceAgentId) fail('PROJECTION_OWNER_INVALID');
  if (event.runId !== null ? event.runId !== run.id : run.context.sourceEventId !== event.id || run.trigger !== `event:${event.topic}`) fail('PROJECTION_SOURCE_INVALID');
  const [previous] = await db.select().from(agentProjectionCandidates).where(and(
    eq(agentProjectionCandidates.studentUserId, input.studentId), eq(agentProjectionCandidates.projectionType, input.projectionType),
    eq(agentProjectionCandidates.status, 'accepted'),
  )).orderBy(desc(agentProjectionCandidates.createdAt)).limit(1);
  const previousResult = object(previous?.payload.result);
  const previousManifest = object(previous?.payload.analysisManifest);
  if (previous && !validateGrowthProjectionResult(input.projectionType, previousResult).ok) fail('PROJECTION_CURRENT_VERSION_INVALID');
  const observedThrough = observation.occurredAt;
  if (typeof previousManifest?.observedThrough === 'string' && previousManifest.observedThrough > observedThrough) fail('PROJECTION_COVERAGE_STALE');
  const baseVersion = previousResult?.version;
  return {
    manifest: { policyVersion: DOMAIN_OBSERVATION_POLICY, sourceEventId: event.id, runId: run.id,
      projectionType: input.projectionType, observedThrough, sourceHash: observation.sourceHash,
      baseCandidateId: previous?.id ?? null, baseVersion: typeof baseVersion === 'number' ? baseVersion : 0 },
    observation, previousResult,
  };
}

async function transitionFact(db: Reader, source: Source): Promise<Fact> {
  const { projectStageLabel } = await import('@qitu/contracts');
  const [event] = await db.select().from(outbox).where(eq(outbox.id, source.sourceId)).limit(1);
  const payload = object(event?.payload);
  if (!event || !['project.advanced', 'project.completed'].includes(event.topic) || !payload
    || typeof payload.studentId !== 'string' || typeof payload.projectId !== 'string'
    || !isStage(payload.from) || !isStage(payload.to) || STAGES.indexOf(payload.to) !== STAGES.indexOf(payload.from) + 1
    || (event.topic === 'project.completed' && payload.to !== 'completed')) fail('PROJECTION_DOMAIN_FACT_INVALID');
  const completed = payload.to === 'completed';
  const stage = completed ? payload.to : payload.from;
  const text = completed ? '项目已由服务端确认为完成。' : `已完成“${projectStageLabel(stage)}”阶段。`;
  return { ...source, studentId: payload.studentId, projectId: payload.projectId, schoolId: null,
    occurredAt: event.createdAt.toISOString(), topic: 'project.stage.completed', type: 'project_stage_completed',
    title: completed ? '项目完成' : '项目阶段完成', factualSummary: text, milestone: text, stage, artifactRef: null,
    objectiveTitles: [], evidenceRefs: [ref('project_event', source.sourceId)] };
}

async function publicationFact(db: Reader, source: Source): Promise<Fact> {
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, source.sourceId)).limit(1);
  if (!artifact || artifact.status !== 'published' || !artifact.publishedAt || !artifact.projectId) fail('PROJECTION_DOMAIN_FACT_INVALID');
  const [version] = await db.select().from(artifactVersions).where(and(eq(artifactVersions.artifactId, artifact.id),
    eq(artifactVersions.ordinal, artifact.currentVersionIndex))).limit(1);
  const [assignment] = await db.select().from(mentorAssignments).where(and(eq(mentorAssignments.studentUserId, artifact.studentUserId),
    eq(mentorAssignments.status, 'active'))).limit(1);
  if (!version || !assignment) fail('PROJECTION_DOMAIN_FACT_INVALID');
  const reviews = await db.select().from(mentorReviews).where(and(eq(mentorReviews.artifactRef, artifact.id),
    eq(mentorReviews.studentUserId, artifact.studentUserId), eq(mentorReviews.projectId, artifact.projectId),
    eq(mentorReviews.mentorUserId, assignment.mentorUserId), eq(mentorReviews.status, 'approved')));
  let reviewId: string | null = null;
  for (const review of reviews) {
    if (!review.reviewedAt || review.reviewedAt > artifact.publishedAt) continue;
    const [request] = await db.select().from(projectEvidence).where(and(eq(projectEvidence.projectId, artifact.projectId),
      eq(projectEvidence.studentUserId, artifact.studentUserId), eq(projectEvidence.artifactId, artifact.id),
      eq(projectEvidence.sourceKind, 'task_submission'), eq(projectEvidence.sourceId, `review:${review.id}`))).limit(1);
    const receipt = jsonObject(request?.detail);
    if (receipt?.schema === 'qitu.artifact-review-request.v1' && receipt.reviewId === review.id
      && receipt.artifactVersionId === version.id && receipt.versionOrdinal === version.ordinal) { reviewId = review.id; break; }
  }
  if (!reviewId) fail('PROJECTION_DOMAIN_FACT_INVALID');
  await verifyProjectTemplate(db, artifact.projectId, artifact.templateVersionId);
  const text = '一份作品已通过班主任对该版本的审核并发布。';
  return { ...source, studentId: artifact.studentUserId, projectId: artifact.projectId, schoolId: artifact.schoolId,
    occurredAt: artifact.publishedAt.toISOString(), topic: 'artifact.published', type: 'artifact_published',
    title: '作品审核发布', factualSummary: text, milestone: text, stage: null, artifactRef: artifact.id,
    objectiveTitles: [], evidenceRefs: [ref('artifact', `${artifact.id}:${version.id}:${reviewId}`)] };
}

async function reflectionFact(db: Reader, source: Source): Promise<Fact> {
  const [evidence] = await db.select().from(projectEvidence).where(eq(projectEvidence.id, source.sourceId)).limit(1);
  const receipt = jsonObject(evidence?.detail);
  const scope = object(receipt?.scope);
  if (!evidence || evidence.sourceKind !== 'reflection' || evidence.columnKind !== 'independent'
    || receipt?.schema !== 'qitu.learning-submission.v1' || receipt.kind !== 'session_response' || !scope
    || scope.projectId !== evidence.projectId || typeof scope.planId !== 'string'
    || typeof scope.learningSessionId !== 'string' || !Number.isSafeInteger(scope.planRevision)
    || !Array.isArray(scope.objectiveIds) || scope.objectiveIds.length === 0
    || typeof receipt.artifactId !== 'string' || receipt.artifactId !== evidence.artifactId
    || typeof receipt.artifactVersionId !== 'string' || typeof receipt.contentDigest !== 'string') fail('PROJECTION_DOMAIN_FACT_INVALID');
  const [plan] = await db.select().from(learningPlans).where(eq(learningPlans.id, scope.planId)).limit(1);
  const [session] = await db.select().from(learningSessions).where(eq(learningSessions.id, scope.learningSessionId)).limit(1);
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, receipt.artifactId)).limit(1);
  const [version] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, receipt.artifactVersionId)).limit(1);
  if (!plan || plan.studentUserId !== evidence.studentUserId || plan.projectId !== evidence.projectId
    || plan.version !== scope.planRevision || !session || session.planId !== plan.id
    || !artifact || artifact.studentUserId !== evidence.studentUserId || artifact.projectId !== evidence.projectId
    || !version || version.artifactId !== artifact.id || !version.note.startsWith('qitu:inline-text:v1:')) fail('PROJECTION_DOMAIN_FACT_INVALID');
  const content = jsonObject(version.note.slice('qitu:inline-text:v1:'.length));
  if (typeof content?.text !== 'string' || digest(content.text) !== receipt.contentDigest) fail('PROJECTION_DOMAIN_FACT_INVALID');
  const objectives = await db.select().from(learningObjectives).where(eq(learningObjectives.planId, plan.id));
  if (scope.objectiveIds.some((id) => typeof id !== 'string' || !objectives.some((item) => item.id === id))) fail('PROJECTION_DOMAIN_FACT_INVALID');
  if (artifact.templateVersionId !== plan.templateVersionId) fail('PROJECTION_DOMAIN_FACT_INVALID');
  await verifyProjectTemplate(db, evidence.projectId, plan.templateVersionId);
  const text = '已保存一份有课时和作品版本依据的学习反思。';
  return { ...source, studentId: evidence.studentUserId, projectId: evidence.projectId, schoolId: evidence.schoolId,
    occurredAt: evidence.occurredAt.toISOString(), topic: 'reflection.created', type: 'reflection_created',
    title: '学习反思已保存', factualSummary: text, milestone: text, stage: null, artifactRef: artifact.id,
    objectiveTitles: [], evidenceRefs: [ref('reflection', JSON.stringify({ evidenceId: evidence.id, versionId: version.id,
      contentDigest: receipt.contentDigest, planId: plan.id, planRevision: plan.version,
      learningSessionId: session.id, objectiveIds: scope.objectiveIds }))] };
}

async function masteryFact(db: Reader, source: Source): Promise<Fact> {
  const [event] = await db.select().from(masteryEvents).where(eq(masteryEvents.id, source.sourceId)).limit(1);
  if (!event || event.eventType === 'revoked' || !event.projectId || !event.objectiveId || !event.planId
    || event.validFrom > new Date()) fail('PROJECTION_DOMAIN_FACT_INVALID');
  const [current] = await db.select().from(masteryRecords).where(and(eq(masteryRecords.studentUserId, event.studentUserId),
    eq(masteryRecords.objectiveId, event.objectiveId))).limit(1);
  const [objective] = await db.select().from(learningObjectives).where(eq(learningObjectives.id, event.objectiveId)).limit(1);
  const [plan] = await db.select().from(learningPlans).where(eq(learningPlans.id, event.planId)).limit(1);
  if (!current || current.sourceEventId !== event.id || current.status !== 'mastered' || current.planId !== event.planId
    || current.knowledgePointId !== event.knowledgePointId || current.courseVersion !== event.courseVersion
    || !objective || objective.planId !== event.planId || objective.type !== event.knowledgeType
    || !plan || plan.studentUserId !== event.studentUserId || plan.projectId !== event.projectId) fail('PROJECTION_DOMAIN_FACT_INVALID');
  const met = event.knowledgeType === 'concept' || event.knowledgeType === 'design'
    ? current.qualitativeMastered && event.qualitativeMastered === true
    : current.masteryBasisPoints >= current.thresholdBasisPoints && event.scoreBasisPoints !== null && event.scoreBasisPoints >= current.thresholdBasisPoints;
  if (!met) fail('PROJECTION_DOMAIN_FACT_INVALID');
  await verifyProjectTemplate(db, event.projectId, plan.templateVersionId);
  const text = '一项学习目标已达到服务端正式评估的掌握标准。';
  return { ...source, studentId: event.studentUserId, projectId: event.projectId, schoolId: event.schoolId,
    occurredAt: event.recordedAt.toISOString(), topic: 'mastery.assessed', type: 'objective_mastered',
    title: '目标掌握已核验', factualSummary: text, milestone: text, stage: null, artifactRef: null,
    objectiveTitles: [objective.name.slice(0, 240)], evidenceRefs: [ref('mastery_event', JSON.stringify({ eventId: event.id,
      assessmentVersion: event.assessmentVersion, sequence: event.sequence, scoreBasisPoints: event.scoreBasisPoints,
      qualitativeMastered: event.qualitativeMastered, thresholdBasisPoints: current.thresholdBasisPoints,
      planId: plan.id, templateVersionId: plan.templateVersionId }))] };
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
async function verifyProjectTemplate(db: Reader, projectId: string, templateVersionId: string | null): Promise<void> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || !templateVersionId || project.templateVersionId !== templateVersionId) fail('PROJECTION_DOMAIN_FACT_INVALID');
}
function ref(kind: string, source: string): string { return `${kind}:${digest(source)}`; }
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function jsonObject(value: string | null | undefined): Record<string, unknown> | null { try { return value ? object(JSON.parse(value)) : null; } catch { return null; } }
function isKind(value: unknown): value is GrowthDomainKind { return ['project_transition', 'published_artifact', 'reflection', 'mastered_objective'].some((kind) => kind === value); }
function isStage(value: unknown): value is ProjectStage { return STAGES.some((stage) => stage === value); }
function fail(code: string): never { throw new Error(code); }
