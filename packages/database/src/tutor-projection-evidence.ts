import { and, desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Database } from './client';
import { agentProjectionCandidates, agentTeamEvents, agentTeamRuns, projects, tutorSessions, tutorTurns } from './schema/index';

type Reader = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/** Private bounded evidence, fetched for one owner and never stored in queue/public payloads. */
export async function readTutorProjectionEvidence(db: Reader, input: {
  sourceEventId: string; runId: string; studentId: string; projectId: string | null;
  projectionType: 'learner_profile' | 'growth_trajectory';
}) {
  const [event] = await db.select().from(agentTeamEvents).where(eq(agentTeamEvents.id, input.sourceEventId)).limit(1);
  const payload = event?.payload;
  if (!event || event.topic !== 'tutor.turn.completed' || !payload || payload.studentUserId !== input.studentId
    || (payload.projectId ?? null) !== input.projectId || typeof payload.sessionId !== 'string'
    || typeof payload.studentTurnId !== 'string' || typeof payload.assistantTurnId !== 'string') throw new Error('PROJECTION_SOURCE_INVALID');
  const [run] = await db.select().from(agentTeamRuns).where(eq(agentTeamRuns.id, input.runId)).limit(1);
  if (!run || run.studentUserId !== input.studentId || run.projectId !== input.projectId
    || typeof payload.sourceAgentId !== 'string' || run.leaderAgentId !== payload.sourceAgentId) throw new Error('PROJECTION_OWNER_INVALID');
  if (event.runId !== null ? event.runId !== run.id : run.context.sourceEventId !== event.id || run.trigger !== `event:${event.topic}`) {
    throw new Error('PROJECTION_SOURCE_INVALID');
  }
  const [session] = await db.select().from(tutorSessions).where(eq(tutorSessions.id, payload.sessionId)).limit(1);
  if (!session || session.studentId !== input.studentId || session.projectId !== input.projectId || session.archivedAt !== null) throw new Error('PROJECTION_OWNER_INVALID');
  const [student] = await db.select().from(tutorTurns).where(and(eq(tutorTurns.id, payload.studentTurnId), eq(tutorTurns.sessionId, session.id), eq(tutorTurns.studentId, input.studentId))).limit(1);
  const [assistant] = await db.select().from(tutorTurns).where(and(eq(tutorTurns.id, payload.assistantTurnId), eq(tutorTurns.sessionId, session.id), eq(tutorTurns.studentId, input.studentId))).limit(1);
  if (!student || !assistant || student.role !== 'student' || assistant.role !== 'assistant' || student.seq >= assistant.seq
    || payload.studentSeq !== student.seq || payload.assistantSeq !== assistant.seq) throw new Error('PROJECTION_SOURCE_INVALID');
  let project: { title: string; status: string } | null = null;
  if (input.projectId !== null) {
    const [row] = await db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.studentUserId, input.studentId))).limit(1);
    if (!row) throw new Error('PROJECTION_OWNER_INVALID');
    project = { title: row.title.slice(0, 160), status: row.status };
  }
  const studentText = Array.isArray(student.blocks) ? student.blocks.flatMap((block: unknown) => {
    if (!block || typeof block !== 'object') return [];
    const item = block as Record<string, unknown>;
    return item.kind === 'text' && typeof item.text === 'string' ? [item.text] : [];
  }).join('\n').slice(0, 4_000).trim() : '';
  if (!studentText) throw new Error('PROJECTION_EVIDENCE_CONTENT_UNAVAILABLE');
  const evidenceRef = `learning_interaction:${student.id}`;
  if (payload.evidenceRef !== evidenceRef) throw new Error('PROJECTION_EVIDENCE_INVALID');
  const [previous] = await db.select().from(agentProjectionCandidates).where(and(
    eq(agentProjectionCandidates.studentUserId, input.studentId), eq(agentProjectionCandidates.projectionType, input.projectionType),
    eq(agentProjectionCandidates.status, 'accepted'),
  )).orderBy(desc(agentProjectionCandidates.createdAt)).limit(1);
  const previousResult = object(previous?.payload.result);
  const previousManifest = object(previous?.payload.analysisManifest);
  const baseVersion = previousResult?.version;
  if (previous && (!Number.isInteger(baseVersion) || Number(baseVersion) < 1)) throw new Error('PROJECTION_CURRENT_VERSION_INVALID');
  const observedThrough = student.createdAt.toISOString();
  if (typeof previousManifest?.observedThrough === 'string' && previousManifest.observedThrough >= observedThrough) throw new Error('PROJECTION_COVERAGE_STALE');
  const manifest = {
    policyVersion: 'tutor-expression.v1' as const,
    sourceEventId: event.id, runId: run.id, sessionId: session.id, studentTurnId: student.id, assistantTurnId: assistant.id,
    projectionType: input.projectionType, observedThrough,
    sourceHash: createHash('sha256').update(JSON.stringify({ studentId: input.studentId, projectId: input.projectId, eventId: event.id, runId: run.id,
      sessionId: session.id, studentTurnId: student.id, assistantTurnId: assistant.id, studentSeq: student.seq, assistantSeq: assistant.seq, studentText })).digest('hex'),
    baseCandidateId: previous?.id ?? null, baseVersion: previous ? Number(baseVersion) : 0,
  };
  return { manifest, studentText, evidenceRef, project, previousResult };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
