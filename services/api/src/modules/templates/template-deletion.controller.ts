import { Body, Controller, Delete, Get, Headers, Param } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { TemplateDeletionService, type DeleteTemplateRecordsInput } from './template-deletion.service';

@Controller('admin/project-templates')
export class TemplateDeletionController {
  constructor(private readonly deletion: TemplateDeletionService, private readonly auth: AuthService) {}

  @Get(':id/deletion-impact')
  async preview(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    return { data: await this.deletion.preview(requireRole(this.auth, cookie, 'admin', '仅管理员可核对删除范围'), id) };
  }

  @Delete(':id/with-records')
  async remove(@Headers('cookie') cookie: string | undefined, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() body: DeleteTemplateRecordsInput) {
    return { data: await this.deletion.remove(requireRole(this.auth, cookie, 'admin', '仅管理员可删除课程'), id, body, key) };
  }
}
