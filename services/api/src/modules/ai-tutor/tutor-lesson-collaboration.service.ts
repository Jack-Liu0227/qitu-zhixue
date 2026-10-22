import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { CurrentUser, TutorLearningScope, TutorLessonCollaborationView } from '@qitu/contracts';
import { TutorService } from './tutor.service';
import { TutorSessionStore } from './tutor-session.store';
import { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { coordinateLessonCollaboration } from './tutor-lesson-collaboration';
import { startTutorTeamRun } from './tutor-team-run';

@Injectable()
export class TutorLessonCollaborationService {
  constructor(private readonly tutor: TutorService, private readonly sessions: TutorSessionStore,
    private readonly runtime: TeamRuntimeService, private readonly registry: PlatformRegistryService,
    private readonly plans: LearningPlanStore) {}

  async read(actor: CurrentUser, projectId: string, scope: TutorLearningScope, key?: string): Promise<TutorLessonCollaborationView> {
    if (actor.role !== 'student') throw new ForbiddenException('课堂协作仅允许学生本人请求');
    if (!Number.isSafeInteger(scope.planRevision) || scope.planRevision < 1 || !scope.planId || !scope.learningSessionId) {
      throw new BadRequestException({ code: 'LESSON_COLLABORATION_SCOPE_INVALID', message: '课时参数无效。' });
    }
    const teaching = await this.tutor.readTeachingForCollaboration(projectId, actor.id);
    if (!teaching || teaching.planId !== scope.planId || teaching.planRevision !== scope.planRevision
      || teaching.session.id !== scope.learningSessionId) throw new ConflictException({ code: 'TUTOR_LESSON_CHANGED', message: '课时已变化，请刷新。' });
    const result: TutorLessonCollaborationView = { projectId, scope, status: 'unavailable', blocks: [] };
    if (!teaching.lesson.collaborationAvailable || await this.plans.findAwaitingQuestion(actor.id, scope.planId)) return result;
    const snapshot = await this.sessions.findByProject(projectId);
    if (!snapshot || snapshot.ownerId !== actor.id) return result;
    const runId = key ? (await startTutorTeamRun({ runtime: this.runtime, projectId, studentId: actor.id,
      tutorSessionId: snapshot.sessionId, leaderAgentId: teaching.bundle.teamVersion.leaderAssistantId,
      turnCount: snapshot.turns.length, pedagogicMove: 'review_work', key: `lesson-help:${key}`,
      onFailure: code => { throw new ConflictException({ code, message: '导师协作暂时无法启动，请稍后重试。' }); } })).id
      : await this.runtime.getLatestRunIdForProject(projectId);
    if (!runId) return { ...result, status: 'idle' };
    const statuses: TutorLessonCollaborationView['status'][] = [];
    result.blocks = await coordinateLessonCollaboration({ runtime: this.runtime, registry: this.registry,
      teaching, runId, studentId: actor.id, projectId, requested: true, assessmentPending: false,
      enqueue: Boolean(key), retryFailedKey: key,
      resolve: () => this.tutor.readTeachingForCollaboration(projectId, actor.id),
      hasResult: ref => snapshot.turns.some(turn => turn.blocks.some(block => block.kind === 'aside' && block.proposalRef === ref)),
      onStatus: status => statuses.push(status),
    });
    const priorities: readonly TutorLessonCollaborationView['status'][] = ['failed', 'running', 'queued', 'ready', 'idle'];
    result.status = priorities.find(status => statuses.includes(status)) ?? 'unavailable';
    if (await this.plans.findAwaitingQuestion(actor.id, scope.planId)) return { ...result, status: 'unavailable', blocks: [] };
    return result;
  }
}
