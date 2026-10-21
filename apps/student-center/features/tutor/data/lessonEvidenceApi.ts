import type {
  LearningEvidenceProof, LearningEvidenceScope, LearningSubmissionArtifactView,
  LearningSubmissionResponse, LearningTextSubmission, LessonEvidenceView,
} from '@qitu/contracts';
import { TutorDataError } from './dataSource';
import type { TutorJsonRequest } from './lessonProgressApi';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
const unwrap = (value: unknown) => record(value) && 'data' in value ? value.data : value;
export type LessonSubmissionKind = 'responses' | 'artifacts' | 'reflections';
export type LessonScope = Pick<LearningEvidenceScope, 'projectId' | 'planId' | 'planRevision' | 'learningSessionId'>;

function scopeMatches(value: unknown, scope: LessonScope, allowOtherLesson = false): boolean {
  return record(value) && value.projectId === scope.projectId && value.planId === scope.planId
    && value.planRevision === scope.planRevision && typeof value.learningSessionId === 'string'
    && (allowOtherLesson || value.learningSessionId === scope.learningSessionId)
    && Array.isArray(value.objectiveIds) && value.objectiveIds.length > 0
    && value.objectiveIds.every((id) => typeof id === 'string' && id.length > 0);
}

function proofMatches(value: unknown, scope: LessonScope, approved = false): value is LearningEvidenceProof {
  return record(value) && scopeMatches(value.scope, scope, approved)
    && typeof value.ref === 'string' && value.ref.length > 0 && typeof value.objectiveId === 'string'
    && ['task_submission', 'experiment_observation', 'reflection'].includes(String(value.sourceKind))
    && (approved ? value.kind === 'approved_artifact'
      : ['session_response', 'experiment_observation', 'submitted_artifact'].includes(String(value.kind)));
}

function invalid(message = '学习证据回执与当前课时不一致，请刷新重试。'): never {
  throw new TutorDataError(message, 502, 'LESSON_EVIDENCE_INVALID');
}

function path(scope: LessonScope) {
  return `/api/v1/learning-plans/${encodeURIComponent(scope.planId)}/sessions/${encodeURIComponent(scope.learningSessionId)}`;
}

export async function getLessonEvidence(fetchJson: TutorJsonRequest, scope: LessonScope): Promise<LessonEvidenceView> {
  const data = unwrap(await fetchJson(`${path(scope)}/evidence?planRevision=${scope.planRevision}`, '学习证据读取失败'));
  if (!record(data) || !scopeMatches(data.scope, scope) || typeof data.sessionType !== 'string'
    || !Array.isArray(data.allowedActions) || !data.allowedActions.every((action) => typeof action === 'string')) invalid();
  for (const key of ['submissions', 'observations', 'approvedArtifacts', 'reflections'] as const) {
    const proofs = data[key];
    if (!Array.isArray(proofs) || proofs.some((proof) => !proofMatches(proof, scope, key === 'approvedArtifacts'))) invalid();
  }
  return data as unknown as LessonEvidenceView;
}

export function assertLearningArtifact(value: unknown, scope: Pick<LessonScope, 'projectId'>): asserts value is LearningSubmissionArtifactView {
  if (!record(value) || typeof value.id !== 'string' || value.projectId !== scope.projectId
    || typeof value.title !== 'string' || typeof value.reviewStatus !== 'string'
    || !['draft', 'submitted', 'in_review', 'published', 'changes_requested', 'archived'].includes(String(value.status))
    || !(value.latestVersion === null || record(value.latestVersion)
      && typeof value.latestVersion.id === 'string'
      && (value.latestVersion.inlineText === null || typeof value.latestVersion.inlineText === 'string'))) invalid();
}

export async function submitLessonEvidence(fetchJson: TutorJsonRequest, scope: LessonScope, kind: LessonSubmissionKind,
  request: LearningTextSubmission, idempotencyKey: string): Promise<LearningSubmissionResponse> {
  if (request.planRevision !== scope.planRevision) throw new TutorDataError('课时版本已变化，请刷新后提交。', 409, 'PLAN_REVISION_MISMATCH');
  const data = unwrap(await fetchJson(`${path(scope)}/${kind}`, '学习内容提交失败', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(request),
  }));
  if (!record(data) || !proofMatches(data.proof, scope) || data.assessmentStatus !== 'assessment_required'
    || data.masteryUpdated !== false || typeof data.replayed !== 'boolean') invalid();
  assertLearningArtifact(data.artifact, scope);
  if (data.proof.artifactId !== data.artifact.id || data.proof.artifactVersionId !== data.artifact.latestVersion?.id) invalid();
  return data as unknown as LearningSubmissionResponse;
}

export async function getLearningArtifact(fetchJson: TutorJsonRequest, projectId: string, artifactId: string): Promise<LearningSubmissionArtifactView> {
  const data = unwrap(await fetchJson(`/api/v1/artifacts/${encodeURIComponent(artifactId)}`, '已保存内容读取失败'));
  assertLearningArtifact(data, { projectId });
  if (data.id !== artifactId) invalid();
  return data;
}

export async function publishLearningArtifact(fetchJson: TutorJsonRequest, projectId: string, artifactId: string, idempotencyKey: string): Promise<LearningSubmissionArtifactView> {
  const data = unwrap(await fetchJson(`/api/v1/artifacts/${encodeURIComponent(artifactId)}/publish`, '作品送审或发布失败', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: '{}',
  }));
  assertLearningArtifact(data, { projectId });
  if (data.id !== artifactId) invalid();
  return data;
}
