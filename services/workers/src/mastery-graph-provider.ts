import { createHash } from 'node:crypto';
import type { MasteryAssessmentEvent } from '@qitu/contracts';

export interface MasteryGraphPayload {
  projectionKey: string;
  payloadHash: string;
  event: MasteryAssessmentEvent;
}
export interface MasteryGraphReceipt { projectionKey: string; payloadHash: string; projectionId: string }
export interface MasteryGraphPort {
  reconcile(payload: MasteryGraphPayload): Promise<MasteryGraphReceipt>;
  inspect(projectionKey: string): Promise<MasteryGraphReceipt | null>;
}

export function masteryGraphPayload(event: MasteryAssessmentEvent): MasteryGraphPayload {
  const minimized: MasteryAssessmentEvent = {
    id: event.id, schoolId: event.schoolId, studentId: event.studentId,
    knowledgePointId: event.knowledgePointId, courseVersion: event.courseVersion,
    objectiveId: event.objectiveId, planId: event.planId, projectId: event.projectId,
    eventType: event.eventType, knowledgeType: event.knowledgeType,
    score: event.score, confidence: event.confidence, qualitativeMastered: event.qualitativeMastered,
    validFrom: event.validFrom, recordedAt: event.recordedAt, sequence: event.sequence,
    evidenceRefs: [...event.evidenceRefs], sourceType: event.sourceType, sourceEventId: event.sourceEventId,
    causationId: event.causationId, correlationId: event.correlationId, supersedesEventId: event.supersedesEventId,
    assessmentVersion: event.assessmentVersion, idempotencyKey: event.idempotencyKey,
  };
  return {
    projectionKey: `mastery-event:${event.id}`,
    payloadHash: createHash('sha256').update(JSON.stringify(minimized)).digest('hex'), event: minimized,
  };
}

/** Private HTTP bridge to the deterministic Graphiti sidecar, not the OSS extraction endpoint. */
export class GraphitiMasteryProvider implements MasteryGraphPort {
  constructor(private readonly options: { baseUrl: string; token: string; fetcher?: typeof fetch; timeoutMs?: number }) {
    const url = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !options.token) throw new Error('GRAPHITI_CONFIG_INVALID');
  }
  async reconcile(payload: MasteryGraphPayload): Promise<MasteryGraphReceipt> {
    return this.request('PUT', payload.projectionKey, payload) as Promise<MasteryGraphReceipt>;
  }
  async inspect(projectionKey: string): Promise<MasteryGraphReceipt | null> {
    return this.request('GET', projectionKey);
  }
  private async request(method: string, key: string, payload?: MasteryGraphPayload): Promise<MasteryGraphReceipt | null> {
    const response = await (this.options.fetcher ?? fetch)(`${this.options.baseUrl.replace(/\/$/u, '')}/v1/mastery/projections/${encodeURIComponent(key)}`, {
      method, headers: { authorization: `Bearer ${this.options.token}`, 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10000), redirect: 'error',
    });
    if (method === 'GET' && response.status === 404) return null;
    if (!response.ok) throw new Error(`GRAPHITI_HTTP_${response.status}`);
    const receipt = await response.json() as Partial<MasteryGraphReceipt>;
    if (receipt.projectionKey !== key || typeof receipt.projectionId !== 'string' || typeof receipt.payloadHash !== 'string'
      || (payload && receipt.payloadHash !== payload.payloadHash)) throw new Error('GRAPHITI_RECEIPT_MISMATCH');
    return receipt as MasteryGraphReceipt;
  }
}
