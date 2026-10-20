import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeishuAssistantHandlers } from './feishu-assistant-handlers';
import type { ReportingService } from './reporting.service';
import type { CurrentUser } from '@qitu/contracts';

test('other assistant bindings return an explicit capability notice until a server handler is registered', async () => {
  let reports = 0;
  const reporting = { buildReport: async () => { reports += 1; throw new Error('Must not aggregate'); } } as unknown as ReportingService;
  const handlers = new FeishuAssistantHandlers(reporting);
  const actor: CurrentUser = { id: 'fixture-admin', role: 'admin', email: 'fixture@example.test', displayName: 'Fixture' };
  assert.match(await handlers.reply('assistant-other', { actor, command: 'report' }), /尚未接入/);
  assert.equal(reports, 0);
  handlers.register('assistant-other', { reply: async ({ actor: current }) => { assert.equal(current.id, actor.id); return 'Registered fixture reply'; } });
  assert.equal(await handlers.reply('assistant-other', { actor, command: 'help' }), 'Registered fixture reply');
  assert.throws(() => handlers.register('assistant-other', { reply: async () => 'Duplicate' }));
});
