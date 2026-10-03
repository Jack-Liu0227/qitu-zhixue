import type { MasteryCurrentProjection, MasteryTimelinePoint } from '@qitu/contracts';
import type { MasteryEventRecord } from '../learning-plan/learning-plan.store';

export const MASTERY_READ_THRESHOLD = 0.9;

export interface MasteryProjectedEvent {
  event: MasteryEventRecord;
  point: MasteryTimelinePoint;
}

export function masteryAggregateKey(knowledgePointId: string, courseVersion: string): string {
  return JSON.stringify([knowledgePointId, courseVersion]);
}

export function projectMasteryEvents(
  events: readonly MasteryEventRecord[],
  knownAt: Date,
): MasteryProjectedEvent[] {
  const groups = new Map<string, MasteryEventRecord[]>();
  for (const event of events) {
    if (event.recordedAt > knownAt) continue;
    const key = masteryAggregateKey(event.knowledgePointId, event.courseVersion);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const result: MasteryProjectedEvent[] = [];
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!;
    group.sort(
      (a, b) =>
        a.validFrom.getTime() - b.validFrom.getTime() ||
        a.recordedAt.getTime() - b.recordedAt.getTime() ||
        a.sequence - b.sequence,
    );
    // Corrections at the same effective instant replace the visible point, not the ledger.
    const resolved: MasteryEventRecord[] = [];
    for (const event of group) {
      if (resolved.at(-1)?.validFrom.getTime() === event.validFrom.getTime()) resolved.pop();
      resolved.push(event);
    }
    for (let index = 0; index < resolved.length; index += 1) {
      const event = resolved[index]!;
      const revoked = event.eventType === 'revoked';
      const quantitative = event.knowledgeType === 'memory' || event.knowledgeType === 'procedure';
      const score = revoked || !quantitative ? null : event.score;
      const qualitativeMastered = revoked || quantitative ? null : event.qualitativeMastered;
      const status = quantitative
        ? score === null
          ? 'new'
          : score >= MASTERY_READ_THRESHOLD
            ? 'mastered'
            : 'learning'
        : qualitativeMastered === null
          ? 'new'
          : qualitativeMastered
            ? 'mastered'
            : 'learning';
      result.push({
        event,
        point: {
          eventId: event.id,
          studentId: event.studentId,
          knowledgePointId: event.knowledgePointId,
          courseVersion: event.courseVersion,
          eventType: event.eventType,
          knowledgeType: event.knowledgeType,
          score,
          confidence: revoked || !quantitative ? null : event.confidence,
          qualitativeMastered,
          status,
          sourceEventId: event.sourceEventId,
          sequence: event.sequence,
          assessmentVersion: event.assessmentVersion,
          validFrom: event.validFrom.toISOString(),
          validTo: resolved[index + 1]?.validFrom.toISOString() ?? null,
          recordedAt: event.recordedAt.toISOString(),
          evidenceRefs: [...event.evidenceRefs],
        },
      });
    }
  }
  return result;
}

export function selectMasteryAt(
  projected: readonly MasteryProjectedEvent[],
  validAt: Date,
): MasteryProjectedEvent[] {
  const current = new Map<string, MasteryProjectedEvent>();
  for (const item of projected) {
    if (item.event.validFrom > validAt) continue;
    const key = masteryAggregateKey(item.event.knowledgePointId, item.event.courseVersion);
    current.set(key, item);
  }
  return [...current.values()];
}

export function toMasteryCurrent({
  event,
  point,
}: MasteryProjectedEvent): MasteryCurrentProjection {
  return {
    studentId: event.studentId,
    knowledgePointId: event.knowledgePointId,
    courseVersion: event.courseVersion,
    knowledgeType: event.knowledgeType,
    objectiveId: event.objectiveId,
    planId: event.planId,
    projectId: event.projectId,
    score: point.score,
    confidence: point.confidence,
    qualitativeMastered: point.qualitativeMastered,
    status: point.status,
    sourceEventId: event.id,
    sequence: event.sequence,
    assessmentVersion: event.assessmentVersion,
    validFrom: point.validFrom,
    validTo: point.validTo,
    updatedAt: point.recordedAt,
  };
}
