import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Query } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { AgentMemoryService } from './agent-memory.service';
import type { MemoryKind } from '@qitu/agent-memory';

@Controller('agent-memory')
export class AgentMemoryController {
  constructor(private readonly auth: AuthService, private readonly memory: AgentMemoryService) {}

  @Get('relationship')
  async listRelationship(
    @Headers('cookie') cookie: string | undefined,
    @Query('partnerId') partnerId: string | undefined,
  ) {
    const actor = this.requireUser(cookie);
    return { data: await this.memory.listRelationship(actor, partnerId ?? '') };
  }

  @Post('relationship')
  async createRelationship(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const actor = this.requireUser(cookie);
    const input = bodyObject(body);
    return { data: await this.memory.createRelationship(actor, {
      partnerId: stringField(input, 'partnerId'), content: stringField(input, 'content'),
      sourceRef: stringField(input, 'sourceRef'), kind: kindField(input, ['preference', 'interest', 'goal']),
      idempotencyKey: requiredKey(idempotencyKey),
    }) };
  }

  @Post('strategy')
  async createStrategy(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const actor = this.requireUser(cookie);
    const input = bodyObject(body);
    return { data: await this.memory.createStrategy(actor, {
      partnerId: stringField(input, 'partnerId'), content: stringField(input, 'content'),
      sourceRef: stringField(input, 'sourceRef'), kind: 'teaching_strategy',
      idempotencyKey: requiredKey(idempotencyKey),
    }) };
  }

  @Post('relationship/:id/correct')
  async correctRelationship(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = this.requireUser(cookie);
    return { data: await this.memory.correct(actor, id, stringField(bodyObject(body), 'content'), requiredKey(idempotencyKey)) };
  }

  @Delete(':id')
  async deleteRelationship(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
  ) {
    const actor = this.requireUser(cookie);
    await this.memory.remove(actor, id, requiredKey(idempotencyKey));
    return { data: { deleted: true } };
  }

  private requireUser(cookie: string | undefined): CurrentUser {
    return requireAnyRole(this.auth, cookie);
  }
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('请求体无效');
  return body as Record<string, unknown>;
}
function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${name} 不能为空`);
  return value.trim();
}
function kindField(body: Record<string, unknown>, allowed: readonly MemoryKind[]): MemoryKind {
  const value = body.kind;
  if (typeof value !== 'string' || !allowed.includes(value as MemoryKind)) throw new BadRequestException('记忆类型无效');
  return value as MemoryKind;
}
function requiredKey(value: string | undefined): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException('该接口必须携带 Idempotency-Key 请求头');
  return value.trim();
}
