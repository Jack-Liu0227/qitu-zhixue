import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { LessonCollaborationScope, ProjectTemplateSpec } from '@qitu/contracts' with { 'resolution-mode': 'import' };
import type { Database } from './client';
import { projects, projectBindingSnapshots, pblTemplateTeamBindings, learningPlans, learningSessions,
  learningSessionProgress, projectEvidence, artifacts, artifactVersions } from './schema/index';

function fail(): never { throw new Error('LESSON_COLLABORATION_SCOPE_INVALID'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
export interface CollaborationRole {
  assistantId: string; instructions: { roleDefinition: string; agentDefinition: string };
  modelByPurpose: { dialogue?: { modelProviderId: string; modelId: string } };
  skills: readonly { canonicalId: string; version: string; packageDigest: string }[];
}

/** Read-only worker boundary. Queue payloads cannot grant a project, role, lesson or source. */
export async function readLessonCollaborationEvidence(db: Database, scope: LessonCollaborationScope, recipient: string) {
  if (!scope || recipient !== scope.recipientAssistantId || recipient === 'qitu-intake-assistant'
    || !Number.isSafeInteger(scope.planRevision) || scope.planRevision < 1
    || !Array.isArray(scope.evidenceRefs) || scope.evidenceRefs.length > 16) fail();
  const [project] = await db.select().from(projects).where(eq(projects.id, scope.projectId)).limit(1);
  const [snapshot] = await db.select().from(projectBindingSnapshots).where(eq(projectBindingSnapshots.projectId, scope.projectId)).limit(1);
  if (!project || project.studentUserId !== scope.studentId || project.templateVersionId !== scope.templateVersionId
    || !snapshot || snapshot.templateVersionId !== scope.templateVersionId || snapshot.teamVersionId !== scope.teamVersionId || !snapshot.bundleDigest) fail();
  const [binding] = await db.select().from(pblTemplateTeamBindings).where(eq(pblTemplateTeamBindings.id, snapshot.bindingId)).limit(1);
  if (!binding || binding.bindingHash !== snapshot.bindingHash || binding.bundleDigest !== snapshot.bundleDigest
    || binding.teamVersionId !== scope.teamVersionId || binding.templateVersionId !== scope.templateVersionId) fail();
  const bundle = object(binding.bundlePayload);
  const template = bundle.template as ProjectTemplateSpec;
  const profile = template.curriculum?.profiles.find(entry => entry.id === bundle.scheduleProfileId);
  const [plan] = await db.select().from(learningPlans).where(eq(learningPlans.id, scope.planId)).limit(1);
  if (!profile || !plan || plan.projectId !== project.id || plan.studentUserId !== scope.studentId
    || plan.templateVersionId !== scope.templateVersionId || plan.version !== scope.planRevision || plan.status !== 'active') fail();
  const sessions = await db.select().from(learningSessions).where(eq(learningSessions.planId, plan.id)).orderBy(asc(learningSessions.index));
  const completions = await db.select().from(learningSessionProgress).where(and(eq(learningSessionProgress.planId, plan.id), eq(learningSessionProgress.planRevision, plan.version)));
  const current = sessions.find(entry => !completions.some(done => done.learningSessionId === entry.id));
  const lesson = profile.sessions.find(entry => entry.sessionIndex === current?.lessonIndex);
  const collaboration = lesson?.collaborators?.find(entry => entry.assistantId === recipient && entry.purpose === scope.purpose
    && scope.activityId === `${current?.id}:activity:${entry.activity}`);
  const roles = bundle.roles as CollaborationRole[];
  const role = Array.isArray(roles) ? roles.find(entry => entry.assistantId === recipient) : undefined;
  if (!current || current.id !== scope.learningSessionId || !lesson || !collaboration || !role
    || collaboration.requiredSkillIds.some(id => !role.skills.some(pin => pin.canonicalId === id))
    || collaboration.trigger === 'after_evidence' && scope.evidenceRefs.length === 0) fail();
  const facts = await db.select().from(projectEvidence).where(and(eq(projectEvidence.projectId, project.id), eq(projectEvidence.studentUserId, scope.studentId)));
  const evidence: { ref: string; label: string; text?: string }[] = [];
  for (const ref of scope.evidenceRefs) {
    const fact = facts.find(entry => `${entry.sourceKind}:${entry.sourceId}` === ref);
    if (!fact || !fact.detail || !['task_submission', 'reflection', 'experiment_observation'].includes(fact.sourceKind)) fail();
    let receipt: Record<string, unknown>;
    try { receipt = object(JSON.parse(fact.detail)); } catch { fail(); }
    if (fact.sourceKind !== 'experiment_observation' && receipt.schema !== 'qitu.learning-submission.v1') fail();
    const saved = object(receipt.scope ?? receipt.receipt ?? receipt);
    if (saved.projectId !== scope.projectId || saved.planId !== scope.planId || saved.planRevision !== scope.planRevision || saved.learningSessionId !== scope.learningSessionId) fail();
    let text: string | undefined = typeof receipt.observation === 'string' ? receipt.observation.slice(0, 1600) : undefined;
    if (typeof receipt.artifactVersionId === 'string' && typeof receipt.artifactId === 'string') {
      const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, receipt.artifactId)).limit(1);
      const [version] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, receipt.artifactVersionId)).limit(1);
      if (!artifact || artifact.projectId !== project.id || artifact.studentUserId !== scope.studentId || !version || version.artifactId !== artifact.id) fail();
      if (version.note.startsWith('qitu:inline-text:v1:')) {
        const content = object(JSON.parse(version.note.slice('qitu:inline-text:v1:'.length)));
        if (typeof content.text !== 'string' || createHash('sha256').update(content.text).digest('hex') !== receipt.contentDigest) fail();
        text = content.text.slice(0, 1600);
      }
    }
    evidence.push({ ref, label: fact.label.slice(0, 200), ...(text ? { text } : {}) });
  }
  return { role, requiredSkillIds: collaboration.requiredSkillIds, leaderAssistantId: object(bundle.teamVersion).leaderAssistantId, lesson: { title: lesson.title, goal: lesson.learningGoal }, evidence };
}
