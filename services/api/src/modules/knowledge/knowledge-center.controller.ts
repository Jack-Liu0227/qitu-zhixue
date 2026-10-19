import {
  Body,
  Controller,
  Get,
  Headers,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { KnowledgeCenterService } from './knowledge-center.service';
import { KnowledgeEngineService } from './knowledge-engine.service';

import { KnowledgeConnectionService } from './knowledge-connection.service';
import { KnowledgeLinkProbeService } from './knowledge-link-probe.service';
import { requireIdempotencyKey } from './knowledge-center.request';
import { KnowledgeToolCatalogService } from './knowledge-tool-catalog.service';
import { KnowledgeSourceSyncService } from './knowledge-source-sync.service';
import { KnowledgeUploadService } from './knowledge-upload.service';
import { KnowledgeLibraryService } from './knowledge-library.service';

@Controller('admin')
export class KnowledgeCenterController {
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly engine: KnowledgeEngineService,
    private readonly auth: AuthService,
    private readonly catalog: KnowledgeToolCatalogService,
    private readonly uploads: KnowledgeUploadService,
    private readonly connections: KnowledgeConnectionService,
    private readonly linkedProbe: KnowledgeLinkProbeService,
    private readonly sourceSync: KnowledgeSourceSyncService,
    @Optional() private readonly library?: KnowledgeLibraryService,
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
  @Post('knowledge/engines/:id/probe')
  async probeEngine(
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.actor(cookie);
    return { data: await this.engine.probe(id, body) };
  }
  @Get('knowledge/bases')
  async bases(@Headers('cookie') cookie: string | undefined) {
    this.actor(cookie);
    return { data: await this.center.bases() };
  }
  @Post('knowledge/engines/:id/ima-bases')
  async imaBases(
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.actor(cookie);
    return { data: await this.engine.listImaBases(id, body) };
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
      data: await this.connections.createBase(this.actor(cookie), body, requireIdempotencyKey(key)),
    };
  }
  @Post('knowledge/bases/link-probe')
  async linkProbe(@Headers('cookie') cookie: string | undefined, @Body() body: unknown) {
    this.actor(cookie);
    return { data: await this.linkedProbe.probeRequest(body) };
  }
  @Post('knowledge/bases/connection-probe')
  async connectionProbe(@Headers('cookie') cookie: string | undefined, @Body() body: unknown) {
    this.actor(cookie);
    return { data: await this.connections.probe(body) };
  }
  @Get('knowledge/bases/:id/bindings')
  async baseBindings(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    this.actor(cookie);
    return { data: await this.center.baseBindings(id) };
  }
  @Post('knowledge/bases/:id/settings')
  async librarySettings(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = this.actor(cookie);
    if (!this.library) throw new ServiceUnavailableException('知识库管理不可用');
    return { data: await this.library.manage(actor, id, body, requireIdempotencyKey(key)) };
  }
  @Get('knowledge/bases/:id/remote-files')
  async remoteFiles(
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Query('folderId') folderId?: string,
    @Query('cursor') cursor?: string,
  ) {
    this.actor(cookie);
    if (!this.library) throw new ServiceUnavailableException('知识库管理不可用');
    return { data: await this.library.documents(id, folderId, cursor) };
  }
  @Get('knowledge/bases/:id/remote-files/:documentId')
  async remoteFile(
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Query('folderId') folderId?: string,
    @Query('cursor') cursor?: string,
  ) {
    this.actor(cookie);
    if (!this.library) throw new ServiceUnavailableException('知识库管理不可用');
    return { data: await this.library.document(id, documentId, folderId, cursor) };
  }
  @Post('knowledge/bases/:id/sources/:sourceId/settings')
  async sourceSettings(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @Body() body: unknown,
  ) {
    const actor = this.actor(cookie);
    if (!this.library) throw new ServiceUnavailableException('知识库管理不可用');
    return {
      data: await this.library.source(actor, id, sourceId, body, requireIdempotencyKey(key)),
    };
  }
  @Put('knowledge/bases/:id/bindings')
  async saveBaseBindings(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.center.saveBaseBindings(
        this.actor(cookie),
        id,
        body,
        requireIdempotencyKey(key),
      ),
    };
  }
  @Post('knowledge/bases/:id/connections/detach')
  async detachConnection(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
  ) {
    return {
      data: await this.connections.detach(this.actor(cookie), id, requireIdempotencyKey(key)),
    };
  }
  @Post('knowledge/bases/:id/sources')
  async createSource(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.sourceSync.create(this.actor(cookie), id, body, requireIdempotencyKey(key)),
    };
  }
  @Post('knowledge/bases/:id/sources/:sourceId/sync')
  async syncSource(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.sourceSync.sync(
        this.actor(cookie),
        id,
        sourceId,
        body,
        requireIdempotencyKey(key),
      ),
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
    @Query('inline') inline?: string,
  ) {
    this.actor(cookie);
    const file = await this.center.original(id, memberId);
    response.set({
      'Content-Type':
        inline === '1' && file.mime_type === 'application/pdf'
          ? 'application/pdf'
          : 'application/octet-stream',
      'Content-Disposition': `${inline === '1' && file.mime_type === 'application/pdf' ? 'inline' : 'attachment'}; filename="document"; filename*=UTF-8''${encodeURIComponent(file.file_name).replace(/'/g, '%27')}`,
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
    const actor = this.actor(cookie);
    const idempotencyKey = requireIdempotencyKey(key);
    return { data: await this.center.updateFile(actor, id, memberId, body, idempotencyKey) };
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

  @Get('knowledge/engine-models')
  engineModels(@Headers('cookie') cookie: string | undefined) {
    this.actor(cookie);
    return { data: this.engine.modelOptions() };
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
    const actor = this.actor(cookie);
    const idempotencyKey = requireIdempotencyKey(key);
    return { data: await this.engine.check(id, `${actor.id}:${idempotencyKey}`) };
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
    const actor = this.actor(cookie);
    return { data: await this.center.cancel(actor, id, requireIdempotencyKey(key)) };
  }
}
