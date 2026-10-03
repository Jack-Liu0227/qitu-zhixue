import { Controller, Get, Headers, Query } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { MasteryReadService } from './mastery.service';
import { masteryLimit, masteryQuery } from './mastery.validation';

const CURRENT_FIELDS = ['studentId', 'knowledgePointId', 'courseVersion', 'validAt', 'knownAt'];

@Controller('mastery')
export class MasteryController {
  constructor(
    private readonly mastery: MasteryReadService,
    private readonly auth: AuthService,
  ) {}

  @Get('current')
  async current(
    @Headers('cookie') cookie: string | undefined,
    @Query() raw: Record<string, unknown> = {},
  ) {
    const actor = this.user(cookie);
    const query = masteryQuery(raw, CURRENT_FIELDS);
    return { data: await this.mastery.getCurrent(actor, query) };
  }

  @Get('timeline')
  async timeline(
    @Headers('cookie') cookie: string | undefined,
    @Query() raw: Record<string, unknown> = {},
  ) {
    const actor = this.user(cookie);
    const query = masteryQuery(raw, [...CURRENT_FIELDS, 'cursor', 'limit']);
    return {
      data: await this.mastery.getTimeline(actor, {
        ...query,
        knowledgePointId: query.knowledgePointId!,
        limit: masteryLimit(query.limit),
      }),
    };
  }

  @Get('snapshot')
  async snapshot(
    @Headers('cookie') cookie: string | undefined,
    @Query() raw: Record<string, unknown> = {},
  ) {
    const actor = this.user(cookie);
    const query = masteryQuery(raw, ['studentId', 'validAt', 'knownAt', 'knowledgePointIds']);
    return {
      data: await this.mastery.getSnapshot(actor, {
        studentId: query.studentId,
        validAt: query.validAt!,
        knownAt: query.knownAt,
        knowledgePointIds:
          query.knowledgePointIds === undefined ? undefined : query.knowledgePointIds.split(','),
      }),
    };
  }

  @Get('threshold')
  async threshold(
    @Headers('cookie') cookie: string | undefined,
    @Query() raw: Record<string, unknown> = {},
  ) {
    const actor = this.user(cookie);
    const query = masteryQuery(raw, CURRENT_FIELDS);
    return {
      data: await this.mastery.getThreshold(actor, {
        ...query,
        knowledgePointId: query.knowledgePointId!,
      }),
    };
  }

  @Get('regressions')
  async regressions(
    @Headers('cookie') cookie: string | undefined,
    @Query() raw: Record<string, unknown> = {},
  ) {
    const actor = this.user(cookie);
    const query = masteryQuery(raw, ['studentId', 'knowledgePointId', 'since', 'knownAt', 'limit']);
    return {
      data: await this.mastery.getRegressionAlerts(actor, {
        ...query,
        limit: masteryLimit(query.limit),
      }),
    };
  }

  private user(cookie: string | undefined): CurrentUser {
    return requireAnyRole(this.auth, cookie);
  }
}
