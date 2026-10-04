import { createApiClient } from './index';
import { createMasteryReadPort } from './mastery';
import type { MasteryReadPort } from '@qitu/contracts';

export interface QituReadSDK {
  readonly mastery: MasteryReadPort;
}

/** Browser entry: only authorized HTTP reads; no server evaluation or stage mutation port. */
export function createQituReadSDK(options: { baseUrl?: string; studentId?: string } = {}): QituReadSDK {
  const transport = createApiClient(options.baseUrl ?? '');
  return Object.freeze({ mastery: createMasteryReadPort(transport, { studentId: options.studentId }) });
}
