import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import {
  agentProjectionCandidates,
  agentTeamEvents,
  agentTeamRuns,
} from '@qitu/database';
import type { AuditWriter } from '../../common/audit/audit.service';
import { GrowthProjectionOwnerService } from './growth-projection-owner.service';

function makeInspectableDb(candidate: Record<string, unknown>, event: Record<string, unknown>, run: Record<string, unknown>) {
  const rows = new Map<unknown, Record<string, unknown>[]>([
    [agentProjectionCandidates, [candidate]],
    [agentTeamEvents, [event]],
    [agentTeamRuns, [run]],
  ]);
  return {
    select: () => {
      let table: unknown;
      const query = {
        from(value: unknown) {
          table = value;
          return query;
        },
        where() { return query; },
        orderBy() { return query; },
        limit() { return Promise.resolve(rows.get(table) ?? []); },
      };
      return query;
    },
  };
}

test('domain owner validates an allowlisted opaque ref against its server event and run', async () => {
  const candidate = {
    id: 'candidate-1',
    runId: 'run-1',
    taskId: 'task-1',
    agentId: 'learner-profile',
    projectionType: 'learner_profile',
    studentUserId: 'student-1',
    projectId: null,
    status: 'proposed',
    payload: {
      contractVersion: 'qitu.growth-projection.v1',
      sourceEventId: 'event-1',
      sourceTopic: 'tutor.turn.completed',
      studentUserId: 'student-1',
      projectId: null,
      evidenceRefs: ['student_answer:answer-1'],
      sourceMetadata: { assistantSeq: 2 },
      result: {
        version: 1,
        priorKnowledge: null,
        targetLevel: null,
        timeBudgetMinutesPerWeek: null,
        preferences: [],
        interests: ['optics'],
        strengths: [],
        nextQuestions: [],
      },
    },
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date('2026-10-20T00:00:00Z'),
  };
  const event = {
    id: 'event-1',
    topic: 'tutor.turn.completed',
    runId: 'run-1',
    payload: { studentUserId: 'student-1', projectId: null, evidenceRefs: ['student_answer:answer-1'] },
  };
  const run = { id: 'run-1', studentUserId: 'student-1', projectId: null };
  const db = makeInspectableDb(candidate, event, run);
  const owner = new GrowthProjectionOwnerService(db as never, {} as AuditWriter);

  assert.deepEqual(await owner.inspect('candidate-1'), { valid: true, errorCodes: [] });
});

test('candidate review schema fields are represented by the forward migration', () => {
  const columns = Object.values(getTableColumns(agentProjectionCandidates)).map((column) => column.name);
  assert.ok(columns.includes('review_error_code'));
  assert.ok(columns.includes('superseded_by_candidate_id'));
  assert.ok(existsSync(resolve(process.cwd(), '../../database/migrations/0041_growth_projection_review.sql')));
  assert.ok(existsSync(resolve(process.cwd(), '../../database/migrations/0041_growth_projection_review.down.sql')));
});
