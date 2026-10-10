import type { CurrentUser } from '@qitu/contracts';

/**
 * Internal service identity for PBL gate-evidence writes (`recordGateForStudent`).
 *
 * This actor is NEVER issued by authentication and NEVER reachable from any
 * HTTP route: it only exists so the audit trail records that the action came
 * from the server-side gate pipeline rather than from a student, teacher or
 * admin session.
 */
export const PBL_GATE_INTERNAL_ACTOR_ID = 'system:pbl-gate';

/**
 * `Role` in `@qitu/contracts` deliberately excludes `'system'` (a system
 * identity cannot log in, and the union must not be widened for one audit
 * writer). The narrow cast lives here, in one place, with this explanation;
 * `AuditWriter` stores `actorRole` as free-form context inside the audit
 * `detail` JSON, so the value is persisted verbatim without touching the
 * auth contract or the audit module.
 */
const SYSTEM_ROLE = 'system' as unknown as CurrentUser['role'];

export const PBL_GATE_INTERNAL_ACTOR: CurrentUser = {
  id: PBL_GATE_INTERNAL_ACTOR_ID,
  email: '',
  displayName: 'PBL 门禁服务（内部）',
  role: SYSTEM_ROLE,
};
