import type { LessonCollaborationScope, TutorReplyBlock, TutorLessonCollaborationView } from '@qitu/contracts';
import type { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import type { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { hashRequest } from '../../common/idempotency';
import type { TutorTeachingContext } from './tutor-teaching-context';
import { freezeTutorRuntime } from './tutor-frozen-runtime';

interface Input {
  runtime?: Pick<TeamRuntimeService, 'delegateLessonCollaboration' | 'listLessonCollaborationTasksForProject'>;
  registry?: Pick<PlatformRegistryService, 'getAssistantRuntime' | 'isModelAvailable'>;
  teaching: TutorTeachingContext | null; runId: string | null; studentId: string; projectId: string | null;
  requested: boolean; assessmentPending: boolean;
  resolve(): Promise<TutorTeachingContext | null>;
  hasResult(ref: string): boolean;
  enqueue?: boolean;
  retryFailedKey?: string;
  onStatus?(status: TutorLessonCollaborationView['status']): void;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function acceptedOutput(value: unknown): value is { suggestion: string; question: string } {
  return object(value) && Object.keys(value).every(key => ['suggestion', 'question'].includes(key))
    && typeof value.suggestion === 'string' && typeof value.question === 'string' && Boolean(value.suggestion.trim()) && Boolean(value.question.trim())
    && value.suggestion.length <= 1000 && value.question.length <= 300 && !/[<>]|https?:|javascript:|data:/iu.test(value.suggestion + value.question);
}
function candidates(teaching: TutorTeachingContext, input: Input) {
  const lesson = teaching.bundle.template.curriculum?.profiles.find(entry => entry.id === teaching.bundle.scheduleProfileId)
    ?.sessions.find(entry => entry.sessionIndex === teaching.session.lessonIndex);
  const activity = teaching.lesson.currentActivity;
  if (!activity || !lesson || !input.projectId) return [];
  const refs = [...new Set(teaching.lesson.evidenceRefs ?? [])].slice(-16);
  return (lesson.collaborators ?? []).filter(entry => entry.activity === activity.kind
    && (entry.trigger === 'on_request' ? input.requested : refs.length > 0)).map(entry => ({
    config: entry, scope: { projectId: input.projectId!, studentId: input.studentId,
      templateVersionId: teaching.bundle.templateVersionId, teamVersionId: teaching.bindingTeamVersionId ?? teaching.bundle.teamVersion.teamVersionId,
      planId: teaching.planId, planRevision: teaching.planRevision, learningSessionId: teaching.session.id,
      activityId: activity.activityId, recipientAssistantId: entry.assistantId, purpose: entry.purpose, evidenceRefs: refs } satisfies LessonCollaborationScope,
  }));
}

/** No completion facts are written. Candidate results are re-authorized before entering a tutor turn. */
export async function coordinateLessonCollaboration(input: Input): Promise<TutorReplyBlock[]> {
  if (!input.runtime || !input.registry || !input.runId || !input.teaching || input.assessmentPending) return [];
  const fresh = await input.resolve();
  if (!fresh || fresh.planId !== input.teaching.planId || fresh.planRevision !== input.teaching.planRevision
    || fresh.session.id !== input.teaching.session.id || fresh.lesson.currentActivity?.activityId !== input.teaching.lesson.currentActivity?.activityId) return [];
  const actor = { id: input.studentId, role: 'student' as const, email: '', displayName: '' };
  const tasks = await input.runtime.listLessonCollaborationTasksForProject(actor, input.projectId!);
  const blocks: TutorReplyBlock[] = [];
  for (const { config, scope } of candidates(fresh, input)) {
    const role = fresh.bundle.roles.find(entry => entry.assistantId === config.assistantId);
    if (!role?.modelByPurpose.dialogue) continue;
    const runtime = freezeTutorRuntime(await input.registry.getAssistantRuntime(role.assistantId), role,
      input.registry.isModelAvailable(role.modelByPurpose.dialogue));
    if (!runtime.agent.capabilities.includes('teach') || config.requiredSkillIds.some(id => !runtime.skills.some(skill => skill.id === id))) continue;
    const task = [...tasks].reverse().find(entry => entry.taskType === 'lesson.collaborate' && entry.agentId === config.assistantId
      && object(entry.input) && object(entry.input.scope) && hashRequest(entry.input.scope) === hashRequest(scope));
    const rejected = task?.status === 'succeeded' && !acceptedOutput(task.output);
    if (!task || (['failed', 'cancelled'].includes(String(task.status)) || rejected) && input.retryFailedKey) {
      if (input.enqueue === false) { input.onStatus?.(task ? 'failed' : 'idle'); continue; }
      await input.runtime.delegateLessonCollaboration(actor, input.runId, { senderAgentId: fresh.bundle.teamVersion.leaderAssistantId,
        recipientAgentId: config.assistantId, input: { scope },
        idempotencyKey: `lesson-collaboration:${hashRequest({ runId: input.runId, scope, retry: task ? input.retryFailedKey : null })}` });
      input.onStatus?.('queued');
      continue;
    }
    input.onStatus?.(rejected || ['failed', 'cancelled'].includes(String(task.status)) ? 'failed'
      : task.status === 'succeeded' ? 'ready' : task.status === 'running' ? 'running' : 'queued');
    const ref = `team-task:${task.id}`;
    if (task.status !== 'succeeded' || input.hasResult(ref)) continue;
    const output = task.output;
    if (!acceptedOutput(output)) continue;
    const phase = fresh.bundle.template.curriculum!.profiles.find(entry => entry.id === fresh.bundle.scheduleProfileId)!
      .sessions.find(entry => entry.sessionIndex === fresh.session.lessonIndex)!.phase;
    blocks.push({ kind: 'aside', copilot: { id: role.assistantId, name: runtime.agent.label, role: '协作导师' }, targetPhase: phase,
      content: `${output.suggestion}\n\n${output.question}`, proposalRef: ref,
      lesson: { index: fresh.session.lessonIndex, title: fresh.lesson.title } });
  }
  const latest = await input.resolve();
  if (!latest || latest.planRevision !== fresh.planRevision || latest.session.id !== fresh.session.id
    || latest.lesson.currentActivity?.activityId !== fresh.lesson.currentActivity?.activityId) return [];
  return blocks;
}
