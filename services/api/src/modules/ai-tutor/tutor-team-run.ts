import type { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import { INTAKE_ASSISTANT_ID } from '../../common/intake-boundary';

/** Exploration is a single-assistant conversation, never an intake-led team run. */
export async function startTutorTeamRun(input: {
  runtime?: Pick<TeamRuntimeService, 'startRun'>; projectId: string | null; studentId: string;
  tutorSessionId: string; leaderAgentId: string; turnCount: number; pedagogicMove: string | null; key: string;
  onFailure(code: string): void;
}): Promise<{ id: string | null; leaderAgentId: string }> {
  if (!input.runtime || !input.projectId || input.leaderAgentId === INTAKE_ASSISTANT_ID) {
    return { id: null, leaderAgentId: input.leaderAgentId };
  }
  try {
    const run = await input.runtime.startRun({ id: input.studentId, role: 'student', email: '', displayName: '' }, {
      leaderAgentId: input.leaderAgentId, studentUserId: input.studentId, projectId: input.projectId,
      tutorSessionId: input.tutorSessionId, trigger: 'tutor.turn',
      context: { turnCount: input.turnCount, pedagogicMove: input.pedagogicMove },
      idempotencyKey: `tutor-team-run:${input.tutorSessionId}:${input.key}`,
    });
    if (typeof run.id !== 'string' || typeof run.leaderAgentId !== 'string') throw new Error('TEAM_RUN_INVALID');
    return { id: run.id, leaderAgentId: run.leaderAgentId };
  } catch (failure) {
    const response: unknown = failure && typeof failure === 'object' && 'getResponse' in failure && typeof failure.getResponse === 'function'
      ? failure.getResponse() : null;
    input.onFailure(response && typeof response === 'object' && 'code' in response && typeof response.code === 'string'
      ? response.code : failure instanceof Error ? failure.name : 'UNKNOWN');
    return { id: null, leaderAgentId: input.leaderAgentId };
  }
}
