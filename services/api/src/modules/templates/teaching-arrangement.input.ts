import { BadRequestException } from '@nestjs/common';
import type { PrepareTeachingArrangementInput } from '@qitu/contracts';

export function parseTeachingArrangement(value: unknown): PrepareTeachingArrangementInput {
  const invalid = (): never => { throw new BadRequestException({ code: 'TEACHING_ARRANGEMENT_INVALID', message: '请选择已有团队及其助手，并重新读取团队配置。' }); };
  const row = (input: unknown): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : invalid();
  const id = (input: unknown): input is string => typeof input === 'string' && input.trim() === input && input.length > 0 && input.length <= 200;
  const date = (input: unknown): input is string => typeof input === 'string' && Number.isFinite(Date.parse(input));
  const exact = (input: Record<string, unknown>, keys: string[]) => { if (Object.keys(input).some(key => !keys.includes(key))) invalid(); };
  const input = row(value);
  exact(input, ['teamId', 'scheduleProfileId', 'sessions', 'teams', 'sourceBinding']);
  if (!id(input.teamId) || !id(input.scheduleProfileId) || !Array.isArray(input.sessions) || !input.sessions.length || input.sessions.length > 128
    || !Array.isArray(input.teams) || !input.teams.length || input.teams.length > 32) return invalid();
  const sessions = input.sessions.map(value => {
    const item = row(value); exact(item, ['sessionIndex', 'teamId', 'kind', 'assistantId']);
    if (!Number.isSafeInteger(item.sessionIndex) || Number(item.sessionIndex) < 1 || !id(item.teamId)) return invalid();
    const common = { sessionIndex: item.sessionIndex as number, teamId: item.teamId };
    if (item.kind === 'team' && item.assistantId === undefined) return { ...common, kind: 'team' as const };
    if (item.kind === 'assistant' && id(item.assistantId)) return { ...common, kind: 'assistant' as const, assistantId: item.assistantId };
    return invalid();
  });
  const teams = input.teams.map(value => {
    const item = row(value); exact(item, ['teamId', 'expectedUpdatedAt']);
    return id(item.teamId) && date(item.expectedUpdatedAt) ? { teamId: item.teamId, expectedUpdatedAt: item.expectedUpdatedAt } : invalid();
  });
  const used = new Set([input.teamId, ...sessions.map(item => item.teamId)]);
  if (new Set(sessions.map(item => item.sessionIndex)).size !== sessions.length || new Set(teams.map(item => item.teamId)).size !== teams.length
    || teams.length !== used.size || teams.some(item => !used.has(item.teamId))) return invalid();
  let sourceBinding: PrepareTeachingArrangementInput['sourceBinding'];
  if (input.sourceBinding !== undefined) {
    const item = row(input.sourceBinding); exact(item, ['id', 'updatedAt']);
    if (!id(item.id) || !date(item.updatedAt)) return invalid();
    sourceBinding = { id: item.id, updatedAt: item.updatedAt };
  }
  return { teamId: input.teamId, scheduleProfileId: input.scheduleProfileId, sessions, teams, ...(sourceBinding ? { sourceBinding } : {}) };
}
