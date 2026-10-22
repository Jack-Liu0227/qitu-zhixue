import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMatrixPatch } from './knowledge-matrix.service';
import { KnowledgeCenterController } from './knowledge-center.controller';

test('matrix changes identify exact libraries and assistants and reject ambiguous writes', () => {
  const input = {
    changes: [
      {
        knowledgeBaseId: 'physics',
        expectedRevision: 4,
        bindings: [{ assistantId: 'mentor', enabled: false }],
      },
    ],
  };
  assert.deepEqual(parseMatrixPatch(input), input);
  for (const body of [
    {},
    { changes: [] },
    { ...input, config: {} },
    { changes: [{ ...input.changes[0], expectedRevision: 1.5 }] },
    { changes: [{ ...input.changes[0], bindings: [{ assistantId: 'mentor', enabled: 'true' }] }] },
    {
      changes: [
        {
          ...input.changes[0],
          bindings: [{ assistantId: 'mentor', enabled: true, mode: 'materialize' }],
        },
      ],
    },
    { changes: [input.changes[0], input.changes[0]] },
    {
      changes: [
        {
          ...input.changes[0],
          bindings: [...input.changes[0]!.bindings, ...input.changes[0]!.bindings],
        },
      ],
    },
  ])
    assert.throws(() => parseMatrixPatch(body));
});

test('matrix and connection operations enforce administrator and idempotency before touching owners', async () => {
  let touched = 0;
  const controller = new KnowledgeCenterController(
    {} as never,
    {} as never,
    { getSession: (id: string) => ({ user: { id, role: id } }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      get: async () => touched++,
      patch: async () => touched++,
      retrieval: async () => touched++,
    } as never,
    { run: async () => touched++ } as never,
  );
  for (const role of ['student', 'teacher', 'parent']) {
    const cookie = `qitu_session=${role}`;
    await assert.rejects(controller.bindingMatrix(cookie), { status: 403 });
    await assert.rejects(controller.patchMatrix(cookie, 'key', {}), { status: 403 });
    await assert.rejects(controller.retrievalSettings(cookie, 'key', {}), { status: 403 });
    await assert.rejects(controller.checkConnection(cookie, 'key', 'kb', {}), { status: 403 });
    await assert.rejects(controller.reconnectLibrary(cookie, 'key', 'kb', {}), { status: 403 });
  }
  await assert.rejects(controller.bindingMatrix(undefined), { status: 401 });
  for (const call of [
    () => controller.patchMatrix('qitu_session=admin', undefined, {}),
    () => controller.checkConnection('qitu_session=admin', undefined, 'kb', {}),
    () => controller.reconnectLibrary('qitu_session=admin', undefined, 'kb', {}),
  ])
    await assert.rejects(call, { status: 400 });
  assert.equal(touched, 0);
  await controller.bindingMatrix('qitu_session=admin');
  assert.equal(touched, 1);
});
