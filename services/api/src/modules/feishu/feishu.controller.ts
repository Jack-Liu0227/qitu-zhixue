import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import type { AdminFeishuSettings, FeishuDeviceAuthorization, FeishuQrSession } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { randomUUID } from 'node:crypto';
import { FeishuService, parseFeishuPatch } from './feishu.service';
import { ReportingService } from './reporting.service';
import { FeishuReportWorker } from './report-worker.service';

@Controller('admin/integrations/feishu')
export class FeishuController {
  constructor(private readonly auth: AuthService, private readonly feishu: FeishuService, private readonly idempotency: IdempotencyStore, private readonly reporting?: ReportingService, private readonly worker?: FeishuReportWorker) {}

  @Get('report')
  async report(@Headers('cookie') cookie: string | undefined, @Query('assistantId') assistantId?: string): Promise<{ data: unknown }> {
    const actor = requireRole(this.auth, cookie, 'admin', '管理汇报仅向管理员开放');
    if (!this.reporting) throw new BadRequestException('汇报服务不可用');
    return { data: await this.reporting.buildReport(actor, parseAssistantId(assistantId)) };
  }

  @Post('deliver')
  async deliver(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown = {},
    @Query('assistantId') queryAssistantId?: string,
  ): Promise<{ data: unknown }> {
    const actor = requireRole(this.auth, cookie, 'admin', '管理汇报仅向管理员开放');
    if (!this.reporting || !this.worker) throw new BadRequestException('汇报服务不可用');
    const assistantId = parseAssistantId(queryAssistantId ?? readAssistantId(body));
    const idempotencyKey = key?.trim() || `deliver-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const report = await this.reporting.buildReport(actor, assistantId);
    const result = await this.worker.deliver({ idempotencyKey, assistantId, report });
    return { data: result };
  }

  @Get('deliveries')
  async deliveries(@Headers('cookie') cookie: string | undefined, @Query('assistantId') assistantId?: string): Promise<{ data: unknown }> {
    requireRole(this.auth, cookie, 'admin', '发送状态仅向管理员开放');
    if (!this.worker) throw new BadRequestException('汇报发送服务不可用');
    return { data: await this.worker.listDeliveries(parseAssistantId(assistantId)) };
  }

  @Get()
  async get(@Headers('cookie') cookie: string | undefined, @Query('assistantId') assistantId?: string): Promise<{ data: AdminFeishuSettings }> {
    requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    return { data: await this.feishu.getSettings(parseAssistantId(assistantId)) };
  }

  @Patch()
  async update(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Query('assistantId') queryAssistantId?: string): Promise<{ data: AdminFeishuSettings }> {
    const actor = requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    const idempotencyKey = key?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少或无效的 Idempotency-Key' });
    const input = parseFeishuPatch(body);
    const assistantId = parseAssistantId(queryAssistantId ?? (input.reportAssistantId ?? undefined));
    const scope = `admin.feishu.update:${assistantId}`;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id, assistantId }, input), async () => ({ status: 200, body: await this.feishu.update(actor, input, assistantId) }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }

  @Post('qr-sessions')
  async createQr(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown = {}): Promise<{ data: FeishuQrSession }> {
    const actor = requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    const idempotencyKey = key?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160) throw new BadRequestException('缺少或无效的 Idempotency-Key');
    const assistantId = parseAssistantId(readAssistantId(body));
    const scope = `admin.feishu.qr.create:${assistantId}`;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id, assistantId }, {}), async () => ({ status: 201, body: await this.feishu.createQrSession(actor, assistantId) }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }

  @Post('device-sessions')
  async beginDevice(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown = {}): Promise<{ data: FeishuDeviceAuthorization }> {
    const actor = requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    const idempotencyKey = key?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少或无效的 Idempotency-Key' });
    const assistantId = parseAssistantId(readAssistantId(body));
    const scope = `admin.feishu.device.begin:${assistantId}`;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id, assistantId }, {}), async () => ({ status: 201, body: await this.feishu.beginDeviceAuthorization(actor, assistantId) }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }

  @Get('qr-sessions/:id')
  async getQr(@Headers('cookie') cookie: string | undefined, @Param('id') id: string): Promise<{ data: FeishuQrSession }> {
    requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    return { data: await this.feishu.getQrSession(id) };
  }

  @Post('device-sessions/:id/poll')
  async pollDevice(@Headers('cookie') cookie: string | undefined, @Param('id') id: string): Promise<{ data: FeishuQrSession }> {
    const actor = requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    return { data: await this.feishu.pollDeviceAuthorization(id, actor) };
  }
}

function readAssistantId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>).assistantId;
  return typeof value === 'string' ? value : undefined;
}

function parseAssistantId(value: string | undefined): string {
  const assistantId = value?.trim() || 'feishu-reporting-assistant';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(assistantId)) {
    throw new BadRequestException({ code: 'FEISHU_CONFIG_INVALID', message: 'assistantId 无效' });
  }
  return assistantId;
}

/** Feishu OAuth callback; code is exchanged by the server and never persisted. */
@Controller('integrations/feishu/oauth')
export class FeishuOAuthController {
  constructor(private readonly feishu: FeishuService) {}

  @Get('callback')
  async callback(@Query('state') state: string, @Query('code') code: string): Promise<{ ok: true }> {
    await this.feishu.completeQrSession(state, code);
    return { ok: true };
  }
}
