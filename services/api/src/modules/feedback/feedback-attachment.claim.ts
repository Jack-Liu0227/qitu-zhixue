import { and, eq, inArray } from 'drizzle-orm';
import { feedbackAttachments } from '@qitu/database';
import type { AuditTransaction } from '../../common/audit/audit.service';
import { invalidAttachment } from './feedback-attachment.validation';

/** Bind uploads in the same transaction as the authoritative feedback entry. */
export async function claimFeedbackAttachments(tx: AuditTransaction, input: {
  actorId: string; childId: string | null; ticketId: string; refs: readonly string[];
}) {
  if (!input.refs.length) return;
  const rows = await tx.select({ id: feedbackAttachments.id, owner: feedbackAttachments.ownerUserId,
    child: feedbackAttachments.childUserId, ticket: feedbackAttachments.ticketId, expires: feedbackAttachments.expiresAt })
    .from(feedbackAttachments).where(inArray(feedbackAttachments.id, [...input.refs])).for('update');
  if (rows.length !== input.refs.length || rows.some(row => row.owner !== input.actorId || row.child !== input.childId
    || row.ticket !== null && row.ticket !== input.ticketId || row.ticket === null && row.expires.getTime() <= Date.now())) return invalidAttachment();
  await tx.update(feedbackAttachments).set({ ticketId: input.ticketId }).where(and(
    inArray(feedbackAttachments.id, [...input.refs]), eq(feedbackAttachments.ownerUserId, input.actorId)));
}
