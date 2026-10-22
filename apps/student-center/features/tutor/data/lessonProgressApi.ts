import type { CompleteLearningSessionRequest, CompleteLearningSessionResponse, LearningSessionProgressView, ReconcileProjectLearningRequest, ReconcileProjectLearningResponse } from '@qitu/contracts';
import { TutorDataError } from './dataSource';

export type TutorJsonRequest = (path: string, label?: string, init?: RequestInit) => Promise<unknown>;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
const unwrap = (value: unknown) => record(value) && 'data' in value ? value.data : value;

export async function reconcileLearning(fetchJson: TutorJsonRequest, projectId: string,
  request: ReconcileProjectLearningRequest, idempotencyKey: string): Promise<ReconcileProjectLearningResponse> {
  const data = unwrap(await fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}/reconcile-learning`, '项目学习进度同步失败', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ planId: request.planId, planRevision: request.planRevision }),
  }));
  if (!record(data) || data.projectId !== projectId || typeof data.stage !== 'string'
    || typeof data.planStatus !== 'string' || typeof data.replayed !== 'boolean'
    || !(data.currentSessionId === null || typeof data.currentSessionId === 'string')) {
    throw new TutorDataError('项目学习进度回执不完整，请刷新核对。', 502, 'LEARNING_RECONCILE_INVALID');
  }
  return data as unknown as ReconcileProjectLearningResponse;
}

export function assertLessonProgress(value: unknown, planId: string, projectId: string): asserts value is LearningSessionProgressView {
  if (!record(value) || value.planId !== planId || value.projectId !== projectId
    || !Number.isSafeInteger(value.planRevision) || Number(value.planRevision) < 1
    || typeof value.contractReady !== 'boolean'
    || !Number.isSafeInteger(value.completedCount) || !Number.isSafeInteger(value.totalCount)
    || !Array.isArray(value.sessions)
    || !(value.currentSessionId === null || typeof value.currentSessionId === 'string')
    || value.sessions.some((item) => !record(item) || typeof item.sessionId !== 'string'
      || !Number.isSafeInteger(item.lessonIndex) || Number(item.lessonIndex) < 1
      || typeof item.title !== 'string' || !['completed', 'current', 'locked'].includes(String(item.status))
      || typeof item.canComplete !== 'boolean' || !Array.isArray(item.blockers)
      || (item.activities !== undefined && (!Array.isArray(item.activities)
        || item.activities.some(activity => !record(activity) || typeof activity.activityId !== 'string'
          || !activity.activityId.startsWith(`${item.sessionId}:activity:`)
          || !['review', 'theory', 'check', 'practice', 'reflect'].includes(String(activity.kind))
          || !['session_response', 'experiment_observation', 'submitted_artifact', 'mastery'].includes(String(activity.evidence))
          || !['completed', 'current', 'locked'].includes(String(activity.status))
          || typeof activity.guidance !== 'string' || !Number.isFinite(activity.minutes)
          || !Array.isArray(activity.evidenceRefs) || activity.evidenceRefs.some(ref => typeof ref !== 'string'))))
      || item.blockers.some((blocker) => typeof blocker !== 'string')
      || !(item.completedAt === null || typeof item.completedAt === 'string'))) {
    throw new TutorDataError('课时进度响应与当前项目不一致，请重新加载。', 502, 'LESSON_PROGRESS_INVALID');
  }
}

export async function getLessonProgress(fetchJson: TutorJsonRequest, planId: string, projectId: string): Promise<LearningSessionProgressView> {
  const data = unwrap(await fetchJson(`/api/v1/learning-plans/${encodeURIComponent(planId)}/progress`, '课时进度读取失败'));
  assertLessonProgress(data, planId, projectId);
  return data;
}

export async function completeLesson(
  fetchJson: TutorJsonRequest, planId: string, sessionId: string,
  request: CompleteLearningSessionRequest, idempotencyKey: string,
): Promise<CompleteLearningSessionResponse> {
  if (!request.evidenceRefs.length || !request.evidenceRefs.every((ref) => typeof ref === 'string' && ref.trim())) {
    throw new TutorDataError('请先选择已保存的本课时学习证据。', 400, 'LESSON_EVIDENCE_REQUIRED');
  }
  const data = unwrap(await fetchJson(
    `/api/v1/learning-plans/${encodeURIComponent(planId)}/sessions/${encodeURIComponent(sessionId)}/complete`,
    '课时完成申请未被接受',
    { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify(request) },
  ));
  if (!record(data) || !record(data.completion) || data.completion.sessionId !== sessionId
    || typeof data.completion.completedAt !== 'string' || !Array.isArray(data.completion.evidenceRefs)
    || !data.completion.evidenceRefs.every((ref) => typeof ref === 'string') || typeof data.replayed !== 'boolean') {
    throw new TutorDataError('课时完成回执不完整，请刷新查看结果。', 502, 'LESSON_COMPLETION_INVALID');
  }
  assertLessonProgress(data.progress, planId, request.projectId);
  return data as unknown as CompleteLearningSessionResponse;
}
