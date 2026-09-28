import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ChildRef,
  GrowthProjectOption,
  ParentGrowthPageData,
  StudentGrowthFilterType,
  StudentGrowthQuery,
  StudentGrowthSummary,
  StudentGrowthTimeline,
} from '@qitu/contracts';
import type { CurrentUser } from '@qitu/contracts';
import { AuthService } from '../identity-auth/auth.service';
import { GrowthService } from './growth.service';

const SESSION_COOKIE = 'qitu_session';

const FILTER_TYPES = new Set<StudentGrowthFilterType>([
  'all',
  'project_stage_completed',
  'artifact_published',
  'reflection_created',
  'objective_mastered',
]);

/**
 * 学生端成长轨迹读接口。
 *
 * 只读是**设计**而非疏漏：成长档案、指标与里程碑没有客户端写路径
 * （growth-spec.md §8，验收标准 2 与 14）。这里连 POST 都不提供。
 */
@Controller('students/me')
export class GrowthController {
  constructor(
    private readonly growthService: GrowthService,
    private readonly authService: AuthService,
  ) {}

  @Get('growth/summary')
  getSummary(@Headers('cookie') cookieHeader: string | undefined): { data: StudentGrowthSummary } {
    const user = this.requireStudent(cookieHeader);
    return { data: this.growthService.getSummary(user.id) };
  }

  @Get('growth')
  getTimeline(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('type') type?: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): { data: { items: StudentGrowthTimeline['items'] }; meta: { nextCursor: string | null; hasNext: boolean } } {
    const user = this.requireStudent(cookieHeader);
    const timeline = this.growthService.getTimeline(user.id, parseQuery({ type, projectId, from, to, cursor, limit }));
    return {
      data: { items: timeline.items },
      meta: { nextCursor: timeline.nextCursor, hasNext: timeline.hasNext },
    };
  }

  @Get('projects/summaries')
  getProjectOptions(
    @Headers('cookie') cookieHeader: string | undefined,
  ): { data: GrowthProjectOption[] } {
    const user = this.requireStudent(cookieHeader);
    return { data: this.growthService.getProjects(user.id) };
  }

  private requireStudent(cookieHeader: string | undefined): CurrentUser {
    return requireRole(this.authService, cookieHeader, 'student', '成长轨迹仅向学生开放');
  }
}

/**
 * 家长端成长轨迹读接口。
 *
 * 与学生端读的是同一份存储（`GrowthService`），所以两端天然同步。
 * 但投影不同，且对象级权限在此**再次校验**：家长只能看到自己绑定的孩子。
 */
@Controller('parent/children')
export class ParentGrowthController {
  constructor(
    private readonly growthService: GrowthService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  async getChildren(@Headers('cookie') cookieHeader: string | undefined): Promise<{ data: ChildRef[] }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    return { data: await this.growthService.getChildren(user.id) };
  }

  @Get(':childId/growth')
  async getChildGrowth(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
    @Query('type') type?: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{ data: ParentGrowthPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');

    // 对象级权限：前端隐藏不算数，这里必须再挡一次。
    if (!(await this.growthService.canParentReadChild(user.id, childId))) {
      throw new ForbiddenException('无权查看该孩子的成长轨迹');
    }

    return {
      data: await this.growthService.getParentPage(
        childId,
        parseQuery({ type, projectId, from, to, cursor, limit }),
      ),
    };
  }
}

function requireRole(
  authService: AuthService,
  cookieHeader: string | undefined,
  role: CurrentUser['role'],
  message: string,
): CurrentUser {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (token === undefined) throw new UnauthorizedException('请先登录');
  const session = authService.getSession(token);
  if (session.user.role !== role) throw new ForbiddenException(message);
  return session.user;
}

function parseQuery(raw: {
  type?: string;
  projectId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: string;
}): StudentGrowthQuery {
  const type = raw.type !== undefined && FILTER_TYPES.has(raw.type as StudentGrowthFilterType)
    ? (raw.type as StudentGrowthFilterType)
    : 'all';
  const limit = raw.limit === undefined ? 20 : Number.parseInt(raw.limit, 10);
  return {
    type,
    projectId: nonEmpty(raw.projectId),
    from: nonEmpty(raw.from),
    to: nonEmpty(raw.to),
    cursor: nonEmpty(raw.cursor),
    limit: Number.isFinite(limit) ? limit : 20,
  };
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}
