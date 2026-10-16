// Operator verification against a running candidate API and its configured DB.
// Uses public test identities; restores every switch in finally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createDb, closeDb } = require('../packages/database/dist');
const { ImaSettingsService } = require('../services/api/dist/modules/platform-registry/ima-settings.service');
const { ImaMcpClient } = require('../services/api/dist/modules/ai-tutor/ima-mcp.client');
const origin = process.env.QITU_VERIFY_API_ORIGIN || 'http://127.0.0.1:14100';
const endpoint = '/api/v1/admin/ai-runtime/mcp/ima-knowledge';

(async () => {
  const login = await fetch(origin + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@qtzx.local', password: 'admin123', rememberMe: false }) });
  assert.equal(login.status, 201);
  const cookie = login.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
  async function request(method, path = endpoint, body, key = randomUUID()) {
    const response = await fetch(origin + path, { method, headers: { cookie, 'content-type': 'application/json', 'idempotency-key': key }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `${method} ${path} returned ${response.status}`);
    return (await response.json()).data;
  }
  const original = await request('GET');
  const assistant = original.assistants.find((row) => row.id === 'tutor-leader');
  const agent = original.agents.find((row) => row.id === 'qitu-learning-partner');
  assert.ok(assistant?.enabled && agent?.enabled, 'Existing enabled test roles required; never enable roles during verification');
  const db = createDb(process.env.DATABASE_URL);
  const access = new ImaSettingsService(db, {});
  const allowed = () => access.canCall(agent.id, 'ima_list_knowledge_bases', assistant.id);
  const report = { checkedAt: new Date().toISOString(), adminLogin: login.status };
  try {
    await request('PATCH', endpoint, { enabled: true, assistantBindings: [{ id: assistant.id, enabled: true }], agentBindings: [{ id: agent.id, enabled: true }] });
    assert.equal(await allowed(), true);
    const tools = await new ImaMcpClient().toolsFor([{ serverId: original.id, label: original.label, transport: original.transport, toolIds: original.tools }], (tool) => access.canCall(agent.id, tool, assistant.id));
    assert.equal(tools.length, original.tools.length);
    const heldTool = tools.find((tool) => tool.name === 'ima_list_knowledge_bases');
    assert.ok(heldTool);
    assert.equal((await heldTool.execute({})).isError, false);
    report.realKnowledgeRead = true;
    const key = randomUUID();
    await request('PATCH', endpoint, { enabled: false }, key);
    await request('PATCH', endpoint, { enabled: false }, key);
    assert.equal((await request('GET')).enabled, false);
    assert.equal(await allowed(), false);
    await assert.rejects(() => heldTool.execute({}), /ACCESS_REVOKED/);
    report.globalDisablePersisted = report.heldToolRevoked = report.idempotentReplay = true;
    await request('PATCH', endpoint, { enabled: true, assistantBindings: [{ id: assistant.id, enabled: false }] });
    assert.equal((await request('GET')).assistants.find((row) => row.id === assistant.id).authorized, false);
    assert.equal(await allowed(), false);
    await assert.rejects(() => heldTool.execute({}), /ACCESS_REVOKED/);
    report.assistantRevocation = true;
    await request('PATCH', endpoint, { assistantBindings: [{ id: assistant.id, enabled: true }], agentBindings: [{ id: agent.id, enabled: false }] });
    assert.equal(await allowed(), false);
    report.agentRevocation = true;
    await request('PATCH', endpoint, { agentBindings: [{ id: agent.id, enabled: true }] });
    assert.equal(await allowed(), true);
    const checked = await request('POST', endpoint + '/check');
    assert.equal(checked.status, 'connected');
    report.realProbe = true;
    report.toolCount = checked.toolCount;
  } finally {
    await request('PATCH', endpoint, { enabled: original.enabled, assistantBindings: [{ id: assistant.id, enabled: assistant.authorized }], agentBindings: [{ id: agent.id, enabled: agent.authorized }] });
    await closeDb(db);
  }
  const restored = await request('GET');
  assert.equal(restored.enabled, original.enabled);
  assert.deepEqual(restored.assistants, original.assistants);
  assert.deepEqual(restored.agents, original.agents);
  report.originalStateRestored = true;
  fs.writeFileSync(process.env.QITU_VERIFY_REPORT || '.runtime/ima-admin-access.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
