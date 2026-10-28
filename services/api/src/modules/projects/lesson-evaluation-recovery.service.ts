import { HttpException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { LessonEvaluationRecoveryStore } from '../works/lesson-evaluation-recovery.store';
import { WorksLearningEvidenceService } from '../works/works-learning-evidence.service';
import { ProjectLearningLifecycleService } from './project-learning-lifecycle.service';

/** API-owned consumer reuses the real Works and Projects owners; no service credentials or model-written facts. */
@Injectable()
export class LessonEvaluationRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LessonEvaluationRecoveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly queue: LessonEvaluationRecoveryStore,
    private readonly evidence: WorksLearningEvidenceService, private readonly lifecycle: ProjectLearningLifecycleService) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.tick(); }, 10_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (this.running) return;
    this.running = true;
    try { await this.runOnce(); }
    catch { this.logger.warn(JSON.stringify({ event: 'lesson.recovery.unavailable', code: 'RECOVERY_STORE_UNAVAILABLE' })); }
    finally { this.running = false; }
  }

  async runOnce(): Promise<'idle' | 'recovered' | 'retry' | 'failed'> {
    const job = await this.queue.claim();
    if (!job) return 'idle';
    try {
      const actor = await this.queue.student(job.request.studentId);
      if (!actor) {
        await this.queue.finish(job, 'LEARNING_EVIDENCE_FORBIDDEN', true);
        return 'failed';
      }
      await this.evidence.resumeLessonEvaluation(actor, job.request);
      await this.lifecycle.reconcile(actor, job.request.projectId,
        { planId: job.request.planId, planRevision: job.request.planRevision }, `${job.id}:sync`);
      await this.queue.finish(job);
      this.logger.log(JSON.stringify({ event: 'lesson.recovery.completed', jobId: job.id, attempt: job.attempts }));
      return 'recovered';
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      const response = error instanceof HttpException ? error.getResponse() : null;
      const code = response && typeof response === 'object' && 'code' in response && typeof response.code === 'string'
        && /^[A-Z_]{1,80}$/u.test(response.code) ? response.code : 'LESSON_RECOVERY_UNAVAILABLE';
      const terminal = status >= 400 && status < 500 && status !== 429 && code !== 'IDEMPOTENCY_CONFLICT';
      await this.queue.finish(job, code, terminal);
      this.logger.warn(JSON.stringify({ event: 'lesson.recovery.failed', jobId: job.id, attempt: job.attempts, code, terminal }));
      return terminal || job.attempts >= 3 ? 'failed' : 'retry';
    }
  }
}
