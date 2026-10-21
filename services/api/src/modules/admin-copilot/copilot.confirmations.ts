import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AdminCopilotActionKind, CurrentUser } from '@qitu/contracts';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { AuditWriter } from '../../common/audit/audit.service';

export interface DeletionDecision {
  actionId: string;
  confirmationId: string;
  decision: 'confirm' | 'cancel';
}

/** Challenges and first decisions use the durable operation journal, shared across API instances. */
export async function deletionConfirmation(
  store: IdempotencyStore, audit: AuditWriter, actor: CurrentUser, stepKey: string,
  kind: AdminCopilotActionKind, input: Record<string, unknown>,
  snapshot: () => Promise<string>, decision?: DeletionDecision,
) {
  const scope = `admin.copilot.deletion-proposal:${actor.id}`;
  const proposal = await store.execute(scope, stepKey, hashIdempotentInput(scope, {}, { kind, input }), async () => {
    const sourceDigest = await snapshot();
    const body = { id: randomUUID(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), sourceDigest, parameters: input,
      target: String(input.id ?? input.templateId ?? `${String(input.providerId)}/${String(input.modelId)}`),
      impact: kind === 'skill.delete' ? '移除当前教学技能，保留历史快照。'
        : kind === 'knowledge.delete' ? '停用本地知识库、撤销连接并取消构建；保留远端资料。'
        : kind === 'mcp.delete' ? '移除本平台的连接登记；保留远端服务。'
        : kind === 'mcp.invoke' ? '调用远端工具，可能修改或删除远端数据；结果未知时不自动重发。'
        : '删除指定配置；已被引用或受保护的对象会被后端拒绝。' };
    await audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.copilot.deletion.proposed',
      targetType: 'copilot_operation', targetId: body.target, idempotencyKey: stepKey,
      detail: { kind, confirmationId: body.id, sourceDigest, expiresAt: body.expiresAt } });
    return { body };
  });
  const challenge = proposal.body;
  const decisionScope = `admin.copilot.deletion-decision:${actor.id}`;
  const decisionHash = hashIdempotentInput(decisionScope, {}, { stepKey, confirmationId: challenge.id });
  if (!decision) {
    const previous = await store.lookup?.<{ decision: 'confirm' | 'cancel' }>(decisionScope, challenge.id, decisionHash);
    if (!previous) return { challenge, decision: 'pending' as const };
    if (previous.body.decision === 'cancel') return { challenge, decision: 'cancel' as const };
    if (Date.now() >= Date.parse(challenge.expiresAt)) throw new ConflictException({
      code: 'COPILOT_CONFIRMATION_EXPIRED', message: '确认有效期已过，请核对操作状态后重新发起指令',
    });
    return { challenge, decision: 'confirm' as const };
  }
  if (decision.confirmationId !== challenge.id) throw new ForbiddenException({
    code: 'COPILOT_CONFIRMATION_INVALID', message: '确认凭据不属于当前管理员、操作或参数',
  });
  if (Date.now() >= Date.parse(challenge.expiresAt)) throw new ConflictException({
    code: 'COPILOT_CONFIRMATION_EXPIRED', message: '删除确认已过期，请重新发起指令',
  });
  const accepted = await store.execute(decisionScope, challenge.id,
    decisionHash, async () => {
      await audit.write({ actorId: actor.id, actorRole: actor.role, action: `admin.copilot.deletion.${decision.decision}`,
        targetType: 'copilot_operation', targetId: challenge.target, idempotencyKey: challenge.id,
        detail: { kind, sourceDigest: challenge.sourceDigest } });
      return { body: { decision: decision.decision } };
    });
  if (accepted.body.decision !== decision.decision) throw new ConflictException({
    code: 'COPILOT_CONFIRMATION_DECIDED', message: '该删除请求已作出其他决定，请重新发起指令',
  });
  return { challenge, decision: accepted.body.decision };
}
