import { TemplateBindingService } from '../templates/templates-binding.service';
import { resolveTutorKnowledgeAccess } from '../ai-tutor/tutor-knowledge-access';
import { Controller, Get, Headers, Inject, forwardRef, NotFoundException, Param, Query } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { ImaSettingsService } from '../platform-registry/ima-settings.service';
import { KnowledgeCenterService } from './knowledge-center.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

@Controller('student')
export class KnowledgeRetrievalController {
  constructor(
    private readonly knowledge: KnowledgeRetrievalService,
    private readonly auth: AuthService,
    private readonly center: KnowledgeCenterService,
    private readonly registry: PlatformRegistryService,
    @Inject(forwardRef(() => TemplateBindingService)) private readonly bindings: TemplateBindingService,
    @Inject(forwardRef(() => ImaSettingsService)) private readonly ima: ImaSettingsService,
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
    // Remote references carry server-owned assistant provenance. Never guess a role
    // from a current template or from a client-provided assistant ID.
    let assistantId: string;
    if (id.startsWith('external~')) {
      const [reference] = await this.center.query<{ assistant_id: string }>(
        sql`SELECT assistant_id FROM knowledge_remote_evidence WHERE id=${id.slice(9)} AND expires_at>now()`,
      );
      if (!reference?.assistant_id) throw new NotFoundException('资料不可用');
      assistantId = reference.assistant_id;
    } else {
      assistantId = await this.registry.resolveProjectAssistantId(null, 'exploration');
    }
    const access = await resolveTutorKnowledgeAccess({
      studentId: actor.id, assistantId, projectId: projectId || null,
      templateVersionId: project?.template_version_id, bindings: this.bindings, ima: this.ima,
      authorizeManagedTool: async toolId => {
        const current = await this.registry.getAssistantRuntime(assistantId);
        return current.agent.enabled && current.agent.toolIds.includes(toolId);
      },
    });
    return { data: await this.knowledge.read(actor.id, assistantId, id, access.managed) };
  }
}
