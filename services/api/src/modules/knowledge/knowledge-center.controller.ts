import { Body, Controller, Get, Headers, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { KnowledgeCenterService } from './knowledge-center.service';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { requireIdempotencyKey } from './knowledge-center.request';
import { KnowledgeToolCatalogService } from './knowledge-tool-catalog.service';
import { KnowledgeUploadService } from './knowledge-upload.service';

@Controller('admin')
export class KnowledgeCenterController {
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly engine: KnowledgeEngineService,
    private readonly auth: AuthService,
    private readonly catalog: KnowledgeToolCatalogService,
    private readonly uploads: KnowledgeUploadService,
  ) {}
  private actor(cookie: string | undefined) {
    return requireRole(this.auth, cookie, 'admin', '知识中心仅向管理员开放');
  }
  @Get('platform-config')
  async config(@Headers('cookie') cookie: string | undefined) {
    this.actor(cookie);
    return { data: await this.center.configuration() };
  }
  @Put('platform-config')
  async save(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return { data: await this.center.save(this.actor(cookie), body, requireIdempotencyKey(key)) };
  }
  @Post('platform-config/validate')
  async validate(@Headers('cookie') cookie: string | undefined, @Body() body: unknown) {
    this.actor(cookie);
    return { data: await this.center.validate(body) };
  }
  @Get('platform-config/tools/:section/:id')
  async tools(
    @Headers('cookie') cookie: string | undefined,
    @Param('section') section: string,
    @Param('id') id: string,
    @Query('refresh') refresh?: string,
  ) {
    this.actor(cookie);
    return { data: await this.catalog.list(section, id, refresh === '1') };
  }
  @Get('knowledge/bases')
  async bases(@Headers('cookie') cookie: string | undefined) {
    this.actor(cookie);
    return { data: await this.center.bases() };
  }
  @Get('knowledge/bases/:id')
  async base(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    this.actor(cookie);
    return { data: await this.center.base(id) };
  }
  @Post('knowledge/bases')
  async create(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return {
      data: await this.center.createBase(this.actor(cookie), body, requireIdempotencyKey(key)),
    };
  }
  @Post('knowledge/bases/:id/files')
  async add(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.center.addFile(this.actor(cookie), id, body, requireIdempotencyKey(key)),
    };
  }
  @Post('knowledge/bases/:id/rebuild')
  async rebuild(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
  ) {
    const actor = this.actor(cookie);
    return { data: await this.center.rebuild(id, `${actor.id}:${requireIdempotencyKey(key)}`) };
  }
  @Post('knowledge/bases/:id/uploads')
  async upload(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.uploads.upload(this.actor(cookie), id, body, requireIdempotencyKey(key)),
    };
  }
  @Get('knowledge/bases/:id/files/:memberId/original')
  async original(
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Res() response: Response,
  ) {
    this.actor(cookie);
    const file = await this.center.original(id, memberId);
    response.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.file_name).replace(/'/g, '%27')}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(file.body);
  }
  @Get('knowledge/bases/:id/files/:memberId')
  async file(
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    this.actor(cookie);
    return { data: await this.center.file(id, memberId) };
  }
  @Post('knowledge/bases/:id/files/:memberId')
  async updateFile(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: unknown,
  ) {
    requireIdempotencyKey(key);
    return { data: await this.center.updateFile(this.actor(cookie), id, memberId, body) };
  }
  @Get('knowledge/assistant-bindings')
  async assistantBindings(@Headers('cookie') cookie: string | undefined) {
    this.actor(cookie);
    return { data: await this.center.assistantBindings() };
  }

  @Put('knowledge/assistant-bindings')
  async saveAssistantBindings(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return {
      data: await this.center.saveAssistantBindings(
        this.actor(cookie),
        body,
        requireIdempotencyKey(key),
      ),
    };
  }

  @Get('knowledge/engines')
  async engines(@Headers('cookie') cookie: string | undefined) {
    this.actor(cookie);
    return { data: await this.center.engines() };
  }
  @Post('knowledge/engines/:id/check')
  async check(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
  ) {
    this.actor(cookie);
    requireIdempotencyKey(key);
    return { data: await this.engine.check(id) };
  }
  @Get('knowledge/jobs/:id')
  async job(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    this.actor(cookie);
    return { data: await this.center.job(id) };
  }
  @Post('knowledge/jobs/:id/cancel')
  async cancel(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
  ) {
    this.actor(cookie);
    requireIdempotencyKey(key);
    return { data: await this.center.cancel(id) };
  }
}
