import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { ProjectKnowledgeService } from './project-knowledge.service';
import { tutorAssistantIdForProject } from '../platform-registry/platform-registry.service';
import { KnowledgeCenterService } from './knowledge-center.service';
import { sql } from 'drizzle-orm';
@Controller('student')
export class ProjectKnowledgeController {
  constructor(
    private readonly knowledge: ProjectKnowledgeService,
    private readonly auth: AuthService,
    private readonly center: KnowledgeCenterService,
  ) {}
  @Get('projects/:id/knowledge')
  async status(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    const actor = requireRole(this.auth, cookie, 'student', '请使用学生账号');
    return { data: await this.knowledge.status(actor.id, id) };
  }
  @Get('knowledge/citations/:id')
  async citation(
    @Headers('cookie') cookie: string | undefined,
    @Param('id') id: string,
    @Query('projectId') projectId: string,
  ) {
    const actor = requireRole(this.auth, cookie, 'student', '请使用学生账号');
    await this.knowledge.owned(actor.id, projectId);
    const [project] = await this.center.query<{ title: string; status: string }>(
      sql`SELECT title,status FROM projects WHERE id=${projectId} AND student_user_id=${actor.id}`,
    );
    return {
      data: await this.knowledge.read(
        actor.id,
        projectId,
        tutorAssistantIdForProject(project!.title, project!.status),
        id,
      ),
    };
  }
}
