import { ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { agentProjectionCandidates, type Database } from '@qitu/database';
import { validateGrowthProjectionResult, type CurrentUser, type ParentAcceptedProfile } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit';
import { DirectoryService } from '../directory/directory.service';

export interface ParentProfileCandidate {
  studentUserId: string | null;
  status: string;
  projectionType: string;
  agentId: string;
  payload: Record<string, unknown>;
  reviewedAt: Date | null;
  reviewedBy: string | null;
}

export function parentAcceptedProfile(childId: string, candidate: ParentProfileCandidate | null): ParentAcceptedProfile {
  const empty: ParentAcceptedProfile = {
    childId, version: 0, updatedAt: null, freshness: 'unavailable', milestonesRecorded: 0, conversationPrompt: null,
  };
  if (!candidate || candidate.studentUserId !== childId || candidate.status !== 'accepted'
    || candidate.projectionType !== 'growth_trajectory'
    || !candidate.reviewedAt || !candidate.reviewedBy) return empty;
  const result = validateGrowthProjectionResult('growth_trajectory', candidate.payload.result);
  if (!result.ok || !result.value || !('milestones' in result.value)) return empty;
  return {
    childId, version: result.value.version, updatedAt: candidate.reviewedAt.toISOString(), freshness: 'fresh',
    milestonesRecorded: result.value.milestones.length,
    conversationPrompt: '可以邀请孩子分享最近一次探究中观察到了什么，以及下一步想验证什么。',
  };
}

@Injectable()
export class ParentAcceptedProfileService {
  constructor(
    private readonly directory: DirectoryService,
    private readonly audit: AuditWriter,
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
  ) {}

  async read(actor: CurrentUser, childId: string): Promise<ParentAcceptedProfile> {
    const allowed = actor.role === 'parent' &&
      (await this.directory.childrenOfParent(actor.id)).some((child) => child.userId === childId);
    if (!allowed) {
      await this.log(actor, childId, 'denied');
      throw new ForbiddenException({ code: 'PARENT_CHILD_ACCESS_DENIED', message: '无权查看该孩子的成长摘要' });
    }
    if (!this.db) throw new ServiceUnavailableException({ code: 'PARENT_PROFILE_UNAVAILABLE', message: '成长摘要存储暂不可用' });
    const [row] = await this.db.select({
      studentUserId: agentProjectionCandidates.studentUserId, status: agentProjectionCandidates.status,
      projectionType: agentProjectionCandidates.projectionType, agentId: agentProjectionCandidates.agentId,
      payload: agentProjectionCandidates.payload, reviewedAt: agentProjectionCandidates.reviewedAt,
      reviewedBy: agentProjectionCandidates.reviewedBy,
    }).from(agentProjectionCandidates).where(and(
      eq(agentProjectionCandidates.studentUserId, childId),
      eq(agentProjectionCandidates.status, 'accepted'),
      eq(agentProjectionCandidates.projectionType, 'growth_trajectory'),
      isNotNull(agentProjectionCandidates.reviewedAt),
      isNotNull(agentProjectionCandidates.reviewedBy),
    )).orderBy(desc(agentProjectionCandidates.reviewedAt)).limit(1);
    const result = parentAcceptedProfile(childId, row ?? null);
    await this.log(actor, childId, result.freshness);
    return result;
  }

  private log(actor: CurrentUser, childId: string, outcome: string) {
    return this.audit.write({
      actorId: actor.id, actorRole: actor.role, action: 'parent.profile.read', targetType: 'student',
      targetId: childId, idempotencyKey: `parent.profile.read:${randomUUID()}`,
      detail: { outcome, visibilityContract: 'parent.accepted-profile.v1' },
    });
  }
}
