import { BadRequestException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '@qitu/database';
import type { TutorTeamHistoryPage } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { TutorService } from './tutor.service';
import { parseTeamHistoryCursor, projectTeamHistory, teamHistoryCursor, type TeamHistoryRow } from './tutor-team-history';

@Injectable()
export class TutorTeamHistoryService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null, private readonly tutor: TutorService) {}

  async read(studentId: string, projectId: string, assistantId: string, cursor?: string): Promise<TutorTeamHistoryPage> {
    if (!projectId || projectId.length > 160 || !assistantId || assistantId.length > 160) {
      throw new BadRequestException({ code: 'TUTOR_HISTORY_SCOPE_REQUIRED', message: '请选择项目与团队成员。' });
    }
    const graph = await this.tutor.getTeamGraph(projectId, studentId);
    if (!graph.agents.some(agent => agent.assistantId === assistantId)) {
      throw new ForbiddenException({ code: 'TUTOR_HISTORY_FORBIDDEN', message: '无权查看该团队成员的历史。' });
    }
    if (!this.db) throw new ServiceUnavailableException({ code: 'TUTOR_HISTORY_UNAVAILABLE', message: '历史记录存储暂不可用。' });
    const before = parseTeamHistoryCursor(cursor, projectId, assistantId);
    const limit = 20;
    const rows = (await this.db.execute<TeamHistoryRow>(sql`
      select h.* from (
        select 'turn:' || t.id as key, 'conversation' as kind, t.created_at as occurred_at,
          jsonb_build_object('content', t.content, 'blocks', t.blocks) as payload
        from tutor_turns t inner join tutor_sessions s on s.id = t.session_id
        where s.project_id = ${projectId} and s.student_id = ${studentId} and t.student_id = ${studentId}
          and t.role = 'assistant'
        union all
        select 'message:' || m.id, 'collaboration', m.created_at, jsonb_build_object('type', m.message_type)
        from agent_team_messages m inner join agent_team_runs r on r.id = m.run_id
        where r.project_id = ${projectId} and r.student_user_id = ${studentId}
          and (m.sender_agent_id = ${assistantId} or m.recipient_agent_id = ${assistantId} or m.mailbox_agent_id = ${assistantId})
        union all
        select 'event:' || e.id, 'tool', e.occurred_at,
          jsonb_build_object('name', e.payload->>'toolName', 'status', e.payload->>'status', 'callId', e.id)
        from agent_team_events e inner join agent_team_runs r on r.id = e.run_id
          inner join agent_team_tasks task on task.id = e.task_id and task.run_id = r.id
        where r.project_id = ${projectId} and r.student_user_id = ${studentId} and task.agent_id = ${assistantId}
          and e.topic = 'team.tool.invoked'
      ) h
      where ${before ? sql`(h.occurred_at, h.key) < (${before.at}::timestamptz, ${before.key})` : sql`true`}
      order by h.occurred_at desc, h.key desc limit ${limit + 1}
    `)).rows;
    const page = rows.slice(0, limit);
    return { projectId, assistantId, items: page.flatMap(row => { const entry = projectTeamHistory(row, assistantId); return entry ? [entry] : []; }),
      nextCursor: rows.length > limit ? teamHistoryCursor(page[page.length - 1]!, projectId, assistantId) : null };
  }
}
