import { Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { FeedbackAttachmentService } from './feedback-attachment.service';

@Controller('feedback/attachments')
export class FeedbackAttachmentController {
  constructor(private readonly auth: AuthService, private readonly attachments: FeedbackAttachmentService) {}
  @Post()
  async upload(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    return { data: await this.attachments.upload(this.actor(cookie), body, key ?? '') };
  }
  @Get(':id/content')
  async download(@Headers('cookie') cookie: string | undefined, @Param('id') id: string, @Res() response: Response) {
    const file = await this.attachments.content(this.actor(cookie), id);
    response.set({ 'Content-Type': file.info.contentType, 'Content-Length': String(file.bytes.length),
      'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.info.fileName).replace(/'/g, '%27')}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    response.send(file.bytes);
  }
  @Delete(':id')
  async remove(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    return { data: await this.attachments.remove(this.actor(cookie), id) };
  }
  private actor(cookie: string | undefined) {
    const actor = requireAnyRole(this.auth, cookie);
    if (actor.role !== 'parent' && actor.role !== 'teacher') throw new ForbiddenException('反馈附件仅供相关家长和教师访问。');
    return actor;
  }
}
