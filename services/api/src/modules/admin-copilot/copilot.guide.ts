import { ADMIN_COPILOT_OPERATIONS } from '@qitu/contracts';

/** Generated from the same catalog exposed to Admin and checked against the management skill. */
export const OPERATION_GUIDE = ADMIN_COPILOT_OPERATIONS.map(operation =>
  `${operation.kind} [${operation.scopes.join(', ')}]: ${operation.inputGuide}`).join('\n');
