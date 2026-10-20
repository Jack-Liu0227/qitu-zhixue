import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { parseTeamHistoryCursor, projectTeamHistory, teamHistoryCursor, type TeamHistoryRow } from './tutor-team-history';
import { TutorTeamHistoryService } from './tutor-team-history.service';

const at = '2026-10-21T00:00:00.000Z';
const row: TeamHistoryRow = { key: 'turn:1', kind: 'conversation', occurred_at: at, payload: {
  content: JSON.stringify({ v: 1, author: { id: 'mentor' }, promptVersion: 'PRIVATE_PROMPT' }),
  blocks: [{ kind: 'text', text: '观察两个现象的区别。' }, { kind: 'quiz', explanation: 'HIDDEN_ANSWER' },
    { kind: 'tool', call: { name: 'ima_search', callId: 'call', status: 'done', result: 'RAW_TOOL_SECRET', arguments: 'PRIVATE_ARGS' } },
    { kind: 'thought', text: 'PRIVATE_REASONING' }],
} };

test('history projects visible assistant blocks and tool status without answers, parameters or internal metadata', () => {
  const result = projectTeamHistory(row, 'mentor');
  assert.equal(result?.summary, '观察两个现象的区别。');
  assert.equal(result?.toolCalls[0]?.status, 'done');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|HIDDEN|RAW_TOOL/);
  assert.equal(projectTeamHistory(row, 'other'), null);
  assert.equal(projectTeamHistory({ ...row, payload: { content: 'legacy text', blocks: [] } }, 'mentor'), null);
});

test('history cursors are bound to project and assistant and reject malformed timestamps', () => {
  const value = teamHistoryCursor(row, 'project', 'mentor');
  assert.equal(parseTeamHistoryCursor(value, 'project', 'mentor')?.key, row.key);
  assert.throws(() => parseTeamHistoryCursor(value, 'foreign-project', 'mentor'));
  assert.throws(() => parseTeamHistoryCursor(value, 'project', 'other'));
  assert.throws(() => parseTeamHistoryCursor(Buffer.from(JSON.stringify({ projectId: 'project', assistantId: 'mentor', key: 'turn:1', at: 'bad' })).toString('base64url'), 'project', 'mentor'));
});

test('history enforces current owned project membership before accessing persistent rows', async () => {
  let queries = 0;
  const db = { execute: async () => { queries++; return { rows: [row] }; } };
  const tutor = { getTeamGraph: async (_project: string, actor: string) => {
    if (actor !== 'owner') throw new ForbiddenException();
    return { agents: [{ assistantId: 'mentor' }] };
  } };
  const service = new TutorTeamHistoryService(db as never, tutor as never);
  await assert.rejects(service.read('other', 'project', 'mentor'), ForbiddenException);
  await assert.rejects(service.read('owner', 'project', 'foreign'), ForbiddenException);
  assert.equal(queries, 0);
  assert.equal((await service.read('owner', 'project', 'mentor')).items.length, 1);
});

test('history query scopes all three sources to the owner and project, paginates with stable timestamp/key', async () => {
  const seen: ReturnType<PgDialect['sqlToQuery']>[] = [];
  const db = { execute: async (query: SQL) => { seen.push(new PgDialect().sqlToQuery(query));
    return { rows: Array.from({ length: 21 }, (_, index) => ({ ...row, key: `turn:${index}` })) }; } };
  const service = new TutorTeamHistoryService(db as never, { getTeamGraph: async () => ({ agents: [{ assistantId: 'mentor' }] }) } as never);
  const first = await service.read('owner', 'project', 'mentor');
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  await service.read('owner', 'project', 'mentor', first.nextCursor);
  assert.equal(seen[0]?.params.filter(value => value === 'project').length, 3);
  assert.equal(seen[0]?.params.filter(value => value === 'owner').length, 4);
  assert.match(seen[1]!.sql, /h\.occurred_at, h\.key/);
  assert.ok(seen[1]!.params.includes('turn:19'));
});
