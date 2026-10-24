import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { CoursewareService } from './courseware.service';

@Controller('admin/knowledge/courseware')
export class CoursewareController {
  constructor(private readonly auth: AuthService, private readonly service: CoursewareService) {}
  @Get()
  async list(@Headers('cookie') cookie?: string) { return { data: await this.service.list(this.actor(cookie)) }; }
  @Post()
  async create(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    return { data: await this.service.create(this.actor(cookie), body, key ?? '') };
  }
  @Patch(':id')
  async review(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    return { data: await this.service.review(this.actor(cookie), id, body, key ?? '') };
  }
  private actor(cookie?: string) { return requireRole(this.auth, cookie, 'admin', '课件治理仅向管理员开放'); }
}
