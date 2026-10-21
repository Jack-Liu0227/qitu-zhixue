import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CopilotMcp } from './copilot.mcp';
import { FakeIdempotencyStore, actor } from '../templates/templates.test-support';

test('generic MCP probes discovery and calls only registered tools; uncertain dispatch is never resent', async () => {
  const admin = actor('admin', 'mcp-fixture');
  let calls = 0, fail = false;
  const source = { id: 'fixture', endpointOrigin: 'https://fixture.invalid/mcp', enabled: false, status: 'not_configured', toolIds: ['echo'] };
  const service = new CopilotMcp({ readMcp: async () => source } as never, new FakeIdempotencyStore(), () => async body => {
    const input = JSON.parse(body) as { method: string; id: number; params: { name?: string } };
    if (input.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result: unknown = input.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } }
      : { tools: ['echo', 'unapproved'].map(name => ({ name, inputSchema: { type: 'object' } })) };
    if (input.method === 'tools/call') {
      assert.equal(input.params.name, 'echo'); calls++;
      if (fail) throw new Error('network disconnected after dispatch');
      result = { content: [{ type: 'text', text: 'Real fixture response' }] };
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }), { headers: { 'content-type': 'application/json' } });
  });
  const probe = await service.probe(admin, 'fixture');
  assert.equal(probe.toolCount, 2);
  assert.equal(probe.teachingRuntimeEnabled, false);
  const result = await service.invoke(admin, { id: 'fixture', toolId: 'echo', arguments: {} }, 'first');
  assert.equal(result.result.text, 'Real fixture response');
  await assert.rejects(service.invoke(admin, { id: 'fixture', toolId: 'unapproved', arguments: {} }, 'denied'));
  assert.equal(calls, 1);
  fail = true;
  await assert.rejects(service.invoke(admin, { id: 'fixture', toolId: 'echo', arguments: {} }, 'uncertain'));
  await assert.rejects(service.invoke(admin, { id: 'fixture', toolId: 'echo', arguments: {} }, 'uncertain'), /远端调用已发出/);
  assert.equal(calls, 2);
  await assert.rejects(service.invoke({ ...admin, role: 'student' }, { id: 'fixture', toolId: 'echo', arguments: {} }, 'student'));
});
