import { Controller, Get, Headers, Param } from '@nestjs/common';
import { requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { WorksService } from './works.service';
import type { ProjectEvidenceView } from './project-evidence.store';

/**
 * 项目证据**只读**接口。
 *
 * 这是设计上的不对称，不是漏写：项目证据由服务端从 `TaskSubmission`、
 * `TutorTurn`、升级事件与反思**聚合**而来（学生前后端设计 §5.4.3），客户端
 * 既不能创建、也不能修改证据项。
 *
 * - 本控制器只有 `GET`，**没有** `POST /projects/:id/evidence`；
 * - 客户端向该路径 `POST` 只会命中不存在的路由（404 / 405），不会写入任何证据；
 * - 授权（学生本人 / 在任班主任 / 已授权家长）在 `WorksService.getProjectEvidence`
 *   再做一次对象级校验。
 */
@Controller('projects/:projectId/evidence')
export class ProjectEvidenceController {
  constructor(
    private readonly works: WorksService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async get(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('projectId') projectId: string,
  ): Promise<{ data: ProjectEvidenceView }> {
    const user = requireAnyRole(this.auth, cookieHeader);
    return { data: await this.works.getProjectEvidence(user, projectId) };
  }
}
