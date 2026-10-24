import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { CurrentUser, TeachingSessionAssignment } from '@qitu/contracts';
import type { TeachingBundlePayload } from './teaching-bundle.types';

export function requireSessionBindingAdmin(actor: CurrentUser, assignments: unknown): void {
  if (assignments !== undefined && actor.role !== 'admin') throw new ForbiddenException({
    code: 'BUNDLE_SESSION_ASSIGNMENT_FORBIDDEN', message: '逐课助手与团队路由由 Admin 统一配置。',
  });
}

export function parseSessionAssignments(value: unknown): readonly TeachingSessionAssignment[] {
  const invalid = (): never => { throw new BadRequestException({ code: 'BUNDLE_SESSION_ASSIGNMENT_INVALID', message: '请为每个课时选择当前教学安排中的团队及助手或团队。' }); };
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) return invalid();
  const seen = new Set<number>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    const row = raw as Record<string, unknown>;
    const id = (input: unknown): input is string => typeof input === 'string' && input.trim() === input && input.length > 0 && input.length <= 200;
    if (Object.keys(row).some(key => !['sessionIndex', 'teamVersionId', 'kind', 'memberId'].includes(key))
      || typeof row.sessionIndex !== 'number' || !Number.isSafeInteger(row.sessionIndex) || row.sessionIndex < 1
      || seen.has(row.sessionIndex) || !id(row.teamVersionId)) return invalid();
    seen.add(row.sessionIndex);
    if (row.kind === 'team' && row.memberId === undefined) return { sessionIndex: row.sessionIndex, teamVersionId: row.teamVersionId, kind: 'team' };
    if (row.kind === 'assistant' && id(row.memberId)) return { sessionIndex: row.sessionIndex, teamVersionId: row.teamVersionId, kind: 'assistant', memberId: row.memberId };
    return invalid();
  });
}

/** Select only from the verified project bundle using the server-owned current lesson. */
export function teachingBundleForSession(bundle: TeachingBundlePayload, sessionIndex: number): TeachingBundlePayload {
  if (!bundle.sessionAssignments) return bundle;
  const assignments = bundle.sessionAssignments.filter(entry => entry.sessionIndex === sessionIndex);
  const assignment = assignments[0];
  const candidates = [bundle, ...(bundle.sessionTeamBundles ?? [])].filter(entry => entry.teamVersion.teamVersionId === assignment?.teamVersionId);
  const selected = candidates[0];
  if (!Number.isSafeInteger(sessionIndex) || assignments.length !== 1 || candidates.length !== 1 || !selected
    || selected.templateVersionId !== bundle.templateVersionId || selected.templateDigest !== bundle.templateDigest
    || selected.scheduleProfileId !== bundle.scheduleProfileId
    || selected.sessionRoutes.filter(route => route.sessionIndex === sessionIndex).length !== 1) {
    throw new ConflictException({ code: 'PROJECT_TEACHING_ROUTE_INVALID', message: '本课缺少有效的冻结教学绑定。' });
  }
  return selected;
}
