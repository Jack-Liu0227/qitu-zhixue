import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import type { Database } from '@qitu/database';
import { sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashRequest } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { LearningPlanService } from '../learning-plan/learning-plan.service';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { resolveTutorTeachingContext } from '../ai-tutor/tutor-teaching-context';

/** Explicitly repairs a missing plan for an already confirmed, frozen project. */
@Injectable()
export class ProjectTeachingPlanRecoveryService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly store: LearningPlanStore, private readonly plans: LearningPlanService,
    private readonly bindings: TemplateBindingService, private readonly audit: AuditWriter,
    private readonly idempotency: IdempotencyStore) {}

  async recover(actor: CurrentUser, id: string, key: string | undefined) {
    if (actor.role !== 'student') throw new ForbiddenException('仅学生本人可恢复本项目的课时计划');
    if (!id || id.length > 200 || !key?.trim() || key.length > 160) throw new BadRequestException('恢复参数或幂等键无效');
    if (!this.db) throw new ServiceUnavailableException('计划恢复服务暂不可用');
    const db = this.db;
    try {
      const result = await this.idempotency.execute(`project.teaching-plan.recover:${actor.id}`, key, hashRequest({ id }), async () => {
        const body = await db.transaction(tx => this.store.withConfirmationTransaction(tx, async store => {
          await tx.execute(sql`SELECT id FROM projects WHERE id=${id} FOR UPDATE`);
          const project = await store.findProject(id);
          if (!project || project.studentId !== actor.id) throw new ForbiddenException('项目不存在或无权恢复');
          if (!project.templateVersionId) throw new ConflictException({ code: 'PROJECT_BINDING_RECONFIRM_REQUIRED', message: '请先由管理员恢复项目的冻结教学配置' });
          const teaching = await this.bindings.getFrozenTeachingBundle(id, project.templateVersionId, tx);
          const existing = (await store.listPlansByStudent(actor.id)).filter(plan => plan.projectId === id);
          if (!existing.length) {
            if (project.status !== 'intent_confirmed') throw new ConflictException({ code: 'PROJECT_PLAN_REVIEW_REQUIRED', message: '项目已有阶段进度，需要教师核查后恢复计划' });
            await this.plans.attachConfirmedProjectPlan(project, tx);
          }
          // Validate the persisted plan against the same frozen contract before reporting success.
          const context = await resolveTutorTeachingContext(store, project, teaching);
          await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'project.teaching_plan.recovered',
            targetType: 'project', targetId: id, idempotencyKey: `project.teaching-plan.recover:${actor.id}:${key}`,
            detail: { planId: context.planId, templateVersionId: project.templateVersionId, created: existing.length === 0 } }, tx);
          return { projectId: id, planId: context.planId, recovered: true as const };
        }));
        return { status: 200, body };
      });
      return { ...result.body, replayed: result.replayed };
    } catch (error) { throwHttpForIdempotencyError(error); throw error; }
  }
}
