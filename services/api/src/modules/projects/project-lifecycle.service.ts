import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser, ProjectStage } from '@qitu/contracts';
import type { QituProjectGate } from '@qitu/ai-client';
import { AuditWriter } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { AccessPolicy } from '../../common/access/access-policy';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { PROJECT_STAGE_ORDER } from './intent-confirmation.state-machine';

@Injectable()
export class ProjectLifecycleService {
  constructor(
    private readonly store: LearningPlanStore,
    private readonly mastery: MasteryDomainService,
    private readonly access: AccessPolicy,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly idempotency: IdempotencyStore,
  ) {}

  async canAdvance(actor: CurrentUser, studentId: string, projectId: string, store = this.store): Promise<QituProjectGate> {
    if (!(await this.access.canReadStudent(actor, studentId))) throw new ForbiddenException('无权访问项目');
    const project = await store.findProject(projectId);
    if (!project || project.studentId !== studentId) throw new NotFoundException('项目不存在');
    const plans = await store.listPlansByStudent(studentId);
    const plan = plans.find((item) => item.projectId === projectId);
    const nextStage = PROJECT_STAGE_ORDER[PROJECT_STAGE_ORDER.indexOf(project.status) + 1] ?? null;
    const reject = (reason: string): QituProjectGate => ({ allowed: false, stage: project.status, nextStage, reason });
    if (!nextStage) return reject('项目已完成');
    if (!plan || plan.status !== 'active' || !plan.confirmedAt) return reject('项目需要已确认且有效的学习计划');
    const bundle = await store.findBundle(plan.id);
    if (!bundle) return reject('学习计划不可用');
    if (['practice_ready', 'practice_building'].includes(nextStage)) {
      const required = [...new Set(bundle.sessions.flatMap((session) => session.theoryObjectiveIds))];
      if (!await this.mastery.checkRequiredObjectives(actor, studentId, plan.id, required, store)) return reject('THEORY_MASTERED_REQUIRED');
    }
    if (nextStage === 'artifact_review') {
      const required = [...new Set(bundle.sessions.flatMap((session) => session.practiceObjectiveIds))];
      if (!await this.mastery.checkRequiredObjectives(actor, studentId, plan.id, required, store)) return reject('PRACTICE_MASTERY_REQUIRED');
    }
    // Publication/review must remain in the Works owner approval workflow.
    if (['reflection', 'published', 'completed'].includes(nextStage)) return reject('PROJECT_REVIEW_REQUIRED');
    return { allowed: true, stage: project.status, nextStage, reason: '阶段前置检查通过' };
  }

  async advance(actor: CurrentUser, studentId: string, projectId: string, key: string): Promise<QituProjectGate> {
    if (actor.role !== 'student' || actor.id !== studentId) throw new ForbiddenException('项目推进仅允许学生本人请求');
    const scope = `project.advance:${studentId}:${projectId}`;
    const outcome = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, { projectId }, {}), async () => {
      const gate = await this.store.withAssessmentTransaction(studentId, async (store) => {
        const checked = await this.canAdvance(actor, studentId, projectId, store);
        if (!checked.allowed || !checked.nextStage) throw new ConflictException({ code: checked.reason, message: '项目前置条件未满足' });
        const changed = await store.transitionProject(studentId, projectId, checked.stage, checked.nextStage as ProjectStage, async (tx) => {
          const id = `project.advance:${projectId}:${checked.stage}`;
          await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'project.advance', targetType: 'project', targetId: projectId, idempotencyKey: id, detail: { from: checked.stage, to: checked.nextStage } }, tx);
          await this.outbox.write({ id, topic: 'project.advanced', payload: { projectId, studentId, from: checked.stage, to: checked.nextStage } }, tx);
        });
        if (!changed) throw new ConflictException('项目阶段已变更');
        return { ...checked, stage: checked.nextStage, nextStage: PROJECT_STAGE_ORDER[PROJECT_STAGE_ORDER.indexOf(checked.nextStage) + 1] ?? null };
      });
      return { status: 200, body: gate };
    });
    return outcome.body;
  }
}
