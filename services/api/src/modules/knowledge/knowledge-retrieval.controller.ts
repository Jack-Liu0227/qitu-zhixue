import { Controller, Get, Headers, NotFoundException, Param, Query } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { KnowledgeCenterService } from './knowledge-center.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

@Controller('student')
export class KnowledgeRetrievalController {
  constructor(
    private readonly knowledge: KnowledgeRetrievalService,
    private readonly auth: AuthService,
    private readonly center: KnowledgeCenterService,
    private readonly registry: PlatformRegistryService,
  ) {}

  @Get('knowledge/citations/:id')
  async citation(
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Query('projectId') projectId?: string,
  ) {
    const actor = requireRole(this.auth, cookie, 'student', '请使用学生账号');
    let project: { template_version_id: string | null; status: string } | undefined;
    if (projectId) {
      [project] = await this.center.query<{ template_version_id: string | null; status: string }>(
        sql`SELECT template_version_id,status FROM projects WHERE id=${projectId} AND student_user_id=${actor.id}`,
      );
      if (!project) throw new NotFoundException('项目不存在');
    }
    const assistantId = await this.registry.resolveProjectAssistantId(
      project?.template_version_id ?? null,
      project?.status ?? 'exploration',
    );
    return { data: await this.knowledge.read(actor.id, assistantId, id) };
  }
}
