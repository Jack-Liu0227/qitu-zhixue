import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { PblBindingStatus, PblTemplateTeamBindingValidation } from '@qitu/contracts';
import { hashRequest } from '../../common/idempotency/idempotency.hash';

/**
 * 模板版本 ↔ 团队版本绑定的领域类型与纯函数（F2 / F3）。
 *
 * 绑定是服务端拥有的不可变引用：模板版本指向 `admin_team_versions` 快照。
 * 项目创建时把生效绑定冻结成 `ProjectBindingSnapshot`；之后退役 / 重新激活
 * 绑定都不会改写既有项目。
 */

/** 团队不可变版本快照的持久化记录。 */
export interface TeamVersionRecord {
  id: string;
  teamId: string;
  version: number;
  name: string;
  description: string;
  workspaceMode: string;
  sessionMode: string;
  leaderAssistantId: string;
  members: unknown[];
  pblSpec: Record<string, unknown>;
  enabled: boolean;
  createdBy: string | null;
  createdAt: Date;
}

/** 绑定的持久化记录。 */
export interface BindingRecord {
  id: string;
  templateVersionId: string;
  teamVersionId: string;
  status: PblBindingStatus;
  bindingHash: string;
  validation: PblTemplateTeamBindingValidation;
  activatedAt: Date | null;
  retiredAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 项目创建时冻结的绑定快照记录。 */
export interface SnapshotRecord {
  projectId: string;
  templateVersionId: string;
  bindingId: string;
  teamVersionId: string;
  bindingHash: string;
  boundAt: Date;
  backfilled: boolean;
}

export interface CreateBindingRecordInput {
  id: string;
  templateVersionId: string;
  teamVersionId: string;
  bindingHash: string;
  createdBy: string | null;
  now: Date;
}

export interface InsertSnapshotRecordInput {
  projectId: string;
  templateVersionId: string;
  bindingId: string;
  teamVersionId: string;
  bindingHash: string;
  boundAt: Date;
  backfilled: boolean;
}

/** B5 预览里受影响的存量项目（仅 id 与标题，绝不含学生原文）。 */
export interface AffectedProjectRecord {
  projectId: string;
  studentUserId: string;
  title: string;
  planId: string | null;
}

/** 新绑定 id。 */
export function newBindingId(): string {
  return `bnd-${createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16)}`;
}

/** 计算团队快照的 pblSpec 指纹（绑定哈希的成分）。 */
export function computePblSpecHash(teamVersion: Pick<TeamVersionRecord, 'pblSpec'>): string {
  return hashRequest(teamVersion.pblSpec ?? {});
}

/** 计算绑定哈希：`sha256(canonicalJson({ templateVersionId, teamVersionId, pblSpecHash }))`。 */
export function computeBindingHash(
  templateVersionId: string,
  teamVersionId: string,
  pblSpecHash: string,
): string {
  return hashRequest({ templateVersionId, teamVersionId, pblSpecHash });
}

/**
 * 服务端计算的绑定校验结果。F2 的 validate 无客户端可写字段：校验由服务端
 * 依据团队快照推导，客户端不得提交 `validation`。
 */
export function computeBindingValidation(
  teamVersion: Pick<
    TeamVersionRecord,
    'enabled' | 'workspaceMode' | 'sessionMode' | 'pblSpec' | 'leaderAssistantId' | 'members'
  >,
): PblTemplateTeamBindingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!teamVersion.enabled) {
    errors.push('TEAM_VERSION_DISABLED');
  }
  if (teamVersion.workspaceMode !== 'shared' && teamVersion.workspaceMode !== 'isolated') {
    errors.push('TEAM_WORKSPACE_MODE_INVALID');
  }
  if (
    teamVersion.sessionMode !== 'auto' &&
    teamVersion.sessionMode !== 'plan' &&
    teamVersion.sessionMode !== 'supervised'
  ) {
    errors.push('TEAM_SESSION_MODE_INVALID');
  }
  if (
    typeof teamVersion.leaderAssistantId !== 'string' ||
    teamVersion.leaderAssistantId.trim().length === 0
  ) {
    errors.push('TEAM_LEADER_ASSISTANT_MISSING');
  }
  if (teamVersion.members.length === 0) {
    warnings.push('TEAM_NO_MEMBERS');
  }
  const pblSpec = teamVersion.pblSpec ?? {};
  if (pblSpec === null || typeof pblSpec !== 'object' || Array.isArray(pblSpec)) {
    errors.push('TEAM_PBL_SPEC_INVALID');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

/** 状态机断言：非法迁移抛 409 + `BINDING_TRANSITION_INVALID`。 */
export function assertBindingStatusTransition(
  from: PblBindingStatus,
  to: PblBindingStatus,
  transitions: Readonly<Record<PblBindingStatus, readonly PblBindingStatus[]>>,
): void {
  if (!transitions[from].includes(to)) {
    throw new BindingTransitionError(from, to);
  }
}

export class BindingTransitionError extends ConflictException {
  constructor(
    readonly from: PblBindingStatus,
    readonly to: PblBindingStatus,
  ) {
    super({
      code: 'BINDING_TRANSITION_INVALID',
      message: `绑定状态不允许从 ${from} 迁移到 ${to}`,
    });
    this.name = 'BindingTransitionError';
  }
}
