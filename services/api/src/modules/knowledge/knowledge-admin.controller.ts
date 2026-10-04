import { Controller, Get, Headers } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { KnowledgeService } from './knowledge.service';
import type { KnowledgeDocumentView } from './knowledge.types';

/** Admin-only knowledge control-plane projection. Full document content is never returned. */
@Controller('admin/knowledge')
export class KnowledgeAdminController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly auth: AuthService,
  ) {}

  @Get('documents')
  async list(@Headers('cookie') cookieHeader: string | undefined): Promise<{ data: KnowledgeDocumentView[] }> {
    const actor = this.requireAdmin(cookieHeader);
    return { data: await this.knowledge.listAdminDocuments(actor) };
  }

  private requireAdmin(cookieHeader: string | undefined): CurrentUser {
    return requireRole(this.auth, cookieHeader, 'admin', '知识库治理仅向管理员开放');
  }
}
