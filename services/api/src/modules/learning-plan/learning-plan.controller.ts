import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import type {
  ConfirmLearningPlanResponse,
  CurrentUser,
  GenerateLearningPlanResponse,
  GenerateLearningPlanRequest,
  LearningPlanView,
  LessonSessionView,
  NextStepView,
  StartSessionResponse,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  SubmitEvidenceRequest,
  SubmitEvidenceResponse,
} from '@qitu/contracts';
import { AuthService } from '../identity-auth/auth.service';
import { pickFields, requireAnyRole, requireRole } from '../../common/access/request-auth';
import {
  assertNoServerOwnedFields,
  PlanGenerationError,
} from './plan-generator';
import { LearningPlanService } from './learning-plan.service';

/**
 * 学习计划 HTTP 接口（产品文档 §4.5 / §9.3–9.4）。
 *
 * | 方法 | 路径 | 角色 | 幂等键 |
 * |------|------|------|--------|
 * | POST | `/api/v1/learning-plans` | student | 否（生成按签名去重） |
 * | POST | `/api/v1/learning-plans/:id/confirm` | student | 是 |
 * | GET  | `/api/v1/learning-plans/:id` | student（本人）/ 班主任（在带） | - |
 * | GET  | `/api/v1/learning-plans/:id/sessions` | 同上 | - |
 * | POST | `/api/v1/learning-plans/:id/sessions/:sessionId/start` | student | 否 |
 * | GET  | `/api/v1/learning-plans/:id/sessions/:sessionId/next-step` | 同上 | - |
 * | POST | `/api/v1/learning-plans/:id/sessions/:sessionId/answers` | student | 是 |
 * | POST | `/api/v1/learning-plans/:id/sessions/:sessionId/evidence` | student | 是 |
 *
 * 三层防线保证客户端改不动服务端状态：
 * 1. `pickFields` 白名单只保留契约字段；
 * 2. `assertNoServerOwnedFields` 对 `stage` / `mastery` / `theoryMastered` /
 *    `projectId` 等显式 400（不是静默丢弃）；
 * 3. 角色与对象级授权在控制器（角色）与 `LearningPlanService`（对象）各校验一次。
 */
@Controller('learning-plans')
export class LearningPlanController {
  constructor(
    private readonly plans: LearningPlanService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async generate(
    @Headers('cookie') cookieHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: GenerateLearningPlanResponse }> {
    const user = this.requireStudent(cookieHeader);
    assertNoServerOwnedFields(body);
    const request = pickFields<GenerateLearningPlanRequest>(body, ['interest', 'weeks', 'goal']);
    return { data: await this.guard(() => this.plans.generatePlan(user, request)) };
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: ConfirmLearningPlanResponse }> {
    const user = this.requireStudent(cookieHeader);
    assertNoServerOwnedFields(body);
    const key = requireIdempotencyKey(idempotencyKey);
    return {
      data: await this.guard(() => this.plans.confirmPlan(user, id, key, pickFields(body, []))),
    };
  }

  @Get(':id')
  async get(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: LearningPlanView }> {
    const user = this.requireUser(cookieHeader);
    return { data: await this.plans.getPlan(user, id) };
  }

  @Get(':id/sessions')
  async listSessions(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: LessonSessionView[] }> {
    const user = this.requireUser(cookieHeader);
    return { data: await this.plans.listSessions(user, id) };
  }

  @Post(':id/sessions/:sessionId/start')
  @HttpCode(200)
  async start(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ): Promise<{ data: StartSessionResponse }> {
    const user = this.requireStudent(cookieHeader);
    assertNoServerOwnedFields(body);
    return { data: await this.plans.startSession(user, id, sessionId) };
  }

  @Get(':id/sessions/:sessionId/next-step')
  async nextStep(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ): Promise<{ data: NextStepView }> {
    const user = this.requireUser(cookieHeader);
    return { data: await this.plans.getNextStep(user, id, sessionId) };
  }

  @Post(':id/sessions/:sessionId/answers')
  @HttpCode(200)
  async answer(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ): Promise<{ data: SubmitAnswerResponse }> {
    const user = this.requireStudent(cookieHeader);
    assertNoServerOwnedFields(body);
    const request = pickFields<SubmitAnswerRequest>(body, ['questionId', 'answer']);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.plans.submitAnswer(user, id, sessionId, request, key) };
  }

  @Post(':id/sessions/:sessionId/evidence')
  @HttpCode(201)
  async evidence(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ): Promise<{ data: SubmitEvidenceResponse }> {
    const user = this.requireStudent(cookieHeader);
    assertNoServerOwnedFields(body);
    const request = pickFields<SubmitEvidenceRequest>(body, [
      'objectiveId',
      'evidenceRef',
      'summary',
    ]);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.plans.submitEvidence(user, id, sessionId, request, key) };
  }

  private requireStudent(cookieHeader: string | undefined): CurrentUser {
    return requireRole(this.auth, cookieHeader, 'student', '学习计划写操作仅向学生开放');
  }

  private requireUser(cookieHeader: string | undefined): CurrentUser {
    return requireAnyRole(this.auth, cookieHeader);
  }

  /** 把纯校验错误翻译成 400，避免泄漏成 500。 */
  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PlanGenerationError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }
}

/** `Idempotency-Key` 有值且去空白后非空，否则 400 + 稳定错误码。 */
function requireIdempotencyKey(raw: string | undefined): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key.length === 0) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '该接口必须携带 Idempotency-Key 请求头',
    });
  }
  return key;
}
