import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import type { ConsultationReceipt, PublicHomeView } from '@qitu/contracts';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { PublicContentService } from './public-content.service';
import { parseConsultationInput } from './public-content.validation';

/** 咨询提交的幂等作用域（与审计 action 同名，便于串联排查）。 */
export const CONSULTATION_IDEMPOTENCY_SCOPE = 'public.consultation.submit';

/** `Idempotency-Key` 长度上限：与 `admin.ai-runtime` 写接口保持一致。 */
const MAX_IDEMPOTENCY_KEY_LENGTH = 160;

/**
 * 公开站点接口（**唯一刻意不鉴权的写接口所在模块**，改动需评审）。
 *
 * - `GET  /api/v1/public/home`           营销首页聚合数据（聚合计数 + 平台共享模板）
 * - `POST /api/v1/public/consultations`  咨询线索提交（幂等 + 审计）
 *
 * 为什么可以公开：
 * - `home` 只回**聚合计数**与**平台共享已发布模板**，不含任何个人标识，也不含校属模板；
 *   它替代不了 `GET /project-templates`（那条仍需学生会话，且会带回本校模板）。
 * - `consultations` 是访客线索入口，没有账号可鉴权；因此用「白名单字段 + 体积上限 +
 *   幂等键 + 审计」替代鉴权，落库字段最小化，绝不回显个人信息。
 *
 * 风险与约束：本控制器**不得**增加任何返回个人数据的接口；一旦需要，就必须改为
 * 需登录 + 对象级校验的接口，而不是在这里放宽可见范围。
 */
@Controller('public')
export class PublicContentController {
  constructor(
    private readonly content: PublicContentService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  @Get('home')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  async getHome(): Promise<{ data: PublicHomeView }> {
    return { data: await this.content.getHomeView() };
  }

  @Post('consultations')
  @HttpCode(201)
  async createConsultation(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ): Promise<{ data: ConsultationReceipt }> {
    const key = readIdempotencyKey(headers);
    // 先校验再占幂等键：非法载荷不得留下幂等记录，否则用户改好再提交会被判冲突。
    const input = parseConsultationInput(body);

    try {
      const result = await this.idempotency.execute(
        CONSULTATION_IDEMPOTENCY_SCOPE,
        key,
        // 指纹含完整载荷：同键不同号码必须报冲突，不能被当成重放而静默丢弃。
        // 该指纹在 `idempotency_keys` 中只保留 24h，号码本身只落 `consultation_requests`。
        hashIdempotentInput(CONSULTATION_IDEMPOTENCY_SCOPE, {}, input),
        async () => ({
          status: 201,
          body: { data: await this.content.submitConsultation(input, key) },
        }),
      );
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }
}

/**
 * 读取幂等键。
 *
 * 同一个键允许两种写法：HTTP 习惯的 `Idempotency-Key`，以及浏览器 `fetch` 里更常见的
 * `X-Idempotency-Key`；两者都接受可以避免前端因为头名不一致把写操作变成重复提交。
 */
function readIdempotencyKey(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers['idempotency-key'] ?? headers['x-idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim() ?? '';
  if (trimmed === '' || trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '缺少或无效的 Idempotency-Key',
    });
  }
  return trimmed;
}
