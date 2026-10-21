import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { closeDb, createDb, feishuInbox, feishuReportDeliveries } from '@qitu/database';
import type { CurrentUser, FeishuReportDocument } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import { encryptModelSecret } from '../../common/secrets/model-secret';
import { DEFAULT_FEISHU_ASSISTANT_ID, FeishuService } from './feishu.service';
import { FeishuReportWorker } from './report-worker.service';
import { FeishuInboxService } from './feishu-inbox.service';
import { FeishuAssistantHandlers } from './feishu-assistant-handlers';
import { FeishuBridgeService } from './feishu-bridge.service';
import type { FeishuSocketFactory } from './feishu-socket.factory';
import type { ReportingService } from './reporting.service';
import { recipientHash } from './feishu-api';

const fixtureUrl = process.env.QITU_FEISHU_TEST_DATABASE_URL;
const isolated = { skip: !fixtureUrl && 'Set QITU_FEISHU_TEST_DATABASE_URL to a disposable local qitu_feishu_fixture database' };
const admin: CurrentUser = { id: 'admin-1', role: 'admin', email: 'admin1@example.test', displayName: 'Fixture admin' };
const key = Buffer.alloc(32, 9);
const report: FeishuReportDocument = {
  summary: { studentCount: 2, parentCount: 2, teacherCount: 1, projectCount: 2, stalledStudentCount: 0, pendingInterventionCount: 0 },
  range: { from: '2026-10-20T00:00:00Z', to: '2026-10-21T00:00:00Z' }, sources: ['fixture'],
  generatedAt: '2026-10-21T00:00:00Z', redacted: true, students: [], parents: [], teachers: [],
};

function migrations(): string {
  let current = process.cwd();
  while (!existsSync(resolve(current, 'database/migrations'))) {
    const parent = dirname(current);
    if (parent === current) throw new Error('Migration directory not found');
    current = parent;
  }
  return resolve(current, 'database/migrations');
}

async function fixture(t: TestContext) {
  if (!fixtureUrl) throw new Error('Fixture URL required');
  const url = new URL(fixtureUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/qitu_feishu_fixture', 'Only the disposable local fixture is allowed');
  const pool = new pg.Pool({ connectionString: fixtureUrl });
  const schema = `feishu_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  const db = createDb(url.toString());
  const client = await pool.connect();
  await client.query(`SET search_path TO "${schema}"`);
  await client.query('CREATE TABLE admin_assistants (id text PRIMARY KEY, enabled boolean NOT NULL); CREATE TABLE users (id text PRIMARY KEY, role text, email text, display_name text, disabled_at timestamptz)');
  for (const file of ['0024_feishu_bot', '0025_feishu_assistant_device_flow', '0026_feishu_admin_bindings', '0027_feishu_report_deliveries', '0044_feishu_message_bridge']) {
    await client.query(readFileSync(resolve(migrations(), `${file}.sql`), 'utf8'));
  }
  const previousKey = process.env.QITU_MODEL_SECRET_KEY;
  process.env.QITU_MODEL_SECRET_KEY = key.toString('hex');
  const audits: unknown[] = [];
  const audit: AuditWriter = { write: async (entry) => { audits.push(entry); return 'fixture-audit'; } };
  await client.query('INSERT INTO admin_assistants VALUES ($1,true),($2,true)', [DEFAULT_FEISHU_ASSISTANT_ID, 'assistant-other']);
  await client.query("INSERT INTO users VALUES ('admin-1','admin','admin1@example.test','Fixture admin',NULL),('admin-2','admin','admin2@example.test','Fixture admin 2',NULL)");
  await client.query('INSERT INTO feishu_bots (id,assistant_id,enabled,inbound_enabled,app_id,app_secret_encrypted,report_recipients) VALUES ($1,$2,true,true,$3,$4,$5)', ['bot-fixture', DEFAULT_FEISHU_ASSISTANT_ID, 'app-fixture', encryptModelSecret('secret-fixture', key), JSON.stringify(['ou-admin-1'])]);
  await client.query('INSERT INTO feishu_admin_bindings (id,assistant_id,open_id_hash,admin_user_id) VALUES ($1,$2,$3,$4)', ['binding-1', DEFAULT_FEISHU_ASSISTANT_ID, recipientHash('ou-admin-1'), admin.id]);
  t.after(async () => {
    if (previousKey === undefined) delete process.env.QITU_MODEL_SECRET_KEY;
    else process.env.QITU_MODEL_SECRET_KEY = previousKey;
    client.release();
    await closeDb(db);
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  });
  return { db, client, audit, audits, service: new FeishuService(db, audit) };
}

function provider(t: TestContext, failRecipientOnce?: string) {
  const sends: Array<{ recipient: string; uuid: string; text: string }> = [];
  let failed = false;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    if (String(url).endsWith('/auth/v3/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'fixture-tenant-token' });
    assert.ok(String(url).includes('/im/v1/messages?receive_id_type=open_id'));
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer fixture-tenant-token');
    sends.push({ recipient: body.receive_id, uuid: body.uuid, text: JSON.parse(body.content).text });
    if (!failed && body.receive_id === failRecipientOnce) { failed = true; return Response.json({ code: 99991400, msg: 'fixture throttle' }); }
    return Response.json({ code: 0, data: { message_id: `receipt-${sends.length}` } });
  });
  return sends;
}

function event(text = '汇报', sender = 'ou-admin-1') {
  return { sender: { sender_type: 'user', sender_id: { open_id: sender } }, message: { chat_type: 'p2p', message_type: 'text', message_id: 'message-fixture', content: JSON.stringify({ text }) } };
}

test('Postgres delivery is sent on first claim, with durable receipts surviving a worker restart', isolated, async (t) => {
  const { db, service } = await fixture(t);
  const sends = provider(t);
  const first = await new FeishuReportWorker(service, undefined, db).deliver({ idempotencyKey: 'daily', report });
  assert.equal(first.status, 'sent');
  const [delivery] = await db.select().from(feishuReportDeliveries);
  assert.equal(delivery?.status, 'sent');
  assert.deepEqual(delivery.completedRecipientHashes, [recipientHash('ou-admin-1')]);
  assert.equal(delivery.attempts, 1);
  assert.equal((await new FeishuReportWorker(service, undefined, db).deliver({ idempotencyKey: 'daily', report })).status, 'already_sent');
  assert.equal(sends.length, 1);
});

test('partial Postgres delivery retries only unfinished recipients with the same provider UUID', isolated, async (t) => {
  const { db, client, service } = await fixture(t);
  await client.query('UPDATE feishu_bots SET report_recipients=$1', [JSON.stringify(['ou-admin-1', 'ou-admin-2'])]);
  await client.query('INSERT INTO feishu_admin_bindings (id,assistant_id,open_id_hash,admin_user_id) VALUES ($1,$2,$3,$4)', ['binding-2', DEFAULT_FEISHU_ASSISTANT_ID, recipientHash('ou-admin-2'), 'admin-2']);
  const sends = provider(t, 'ou-admin-2');
  assert.equal((await new FeishuReportWorker(service, undefined, db).deliver({ idempotencyKey: 'partial', report })).status, 'retryable');
  assert.equal((await new FeishuReportWorker(service, undefined, db).deliver({ idempotencyKey: 'partial', report })).status, 'sent');
  assert.deepEqual(sends.map((send) => send.recipient), ['ou-admin-1', 'ou-admin-2', 'ou-admin-2']);
  assert.equal(sends[1]?.uuid, sends[2]?.uuid);
});

test('concurrent Postgres workers cannot send the same delivery twice and can recover an expired lease', isolated, async (t) => {
  const { db, client, service } = await fixture(t);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started: () => void = () => {};
  const sending = new Promise<void>((resolve) => { started = resolve; });
  const providerCalls = provider(t);
  const original = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).endsWith('/tenant_access_token/internal')) { started(); await gate; }
    return original(...args);
  });
  const first = new FeishuReportWorker(service, undefined, db).deliver({ idempotencyKey: 'concurrent', report });
  await sending;
  assert.equal((await new FeishuReportWorker(service, undefined, db).deliver({ idempotencyKey: 'concurrent', report })).status, 'retryable');
  release();
  assert.equal((await first).status, 'sent');
  assert.equal(providerCalls.length, 1);
  await client.query("INSERT INTO feishu_report_deliveries (id,assistant_id,idempotency_key,status,recipient_hashes,updated_at) VALUES ($1,$2,'expired','sending',$3,now()-interval '10 minutes')", [`${DEFAULT_FEISHU_ASSISTANT_ID}:expired`, DEFAULT_FEISHU_ASSISTANT_ID, JSON.stringify([recipientHash('ou-admin-1').slice(0, 16)])]);
  assert.equal((await new FeishuReportWorker(service, undefined, db).deliver({ idempotencyKey: 'expired', report })).status, 'sent');
});

test('inbound private report is durable, minimized, deduplicated and replies only to its authenticated sender', isolated, async (t) => {
  const { db, service, audit } = await fixture(t);
  const sends = provider(t);
  let generated = 0;
  const reporting = { buildReport: async (actor: CurrentUser, assistantId: string) => {
    assert.equal(actor.id, admin.id); assert.equal(assistantId, DEFAULT_FEISHU_ASSISTANT_ID); generated += 1; return report;
  } } as unknown as ReportingService;
  const inbox = new FeishuInboxService(db, service, new FeishuAssistantHandlers(reporting), audit);
  assert.equal(await inbox.receive(DEFAULT_FEISHU_ASSISTANT_ID, 'app-fixture', event()), true);
  assert.equal(await inbox.receive(DEFAULT_FEISHU_ASSISTANT_ID, 'app-fixture', event()), true);
  const rows = await db.select().from(feishuInbox);
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows).includes('ou-admin-1'), false);
  assert.equal(JSON.stringify(rows).includes('汇报'), false);
  await inbox.drain();
  await inbox.drain();
  assert.equal(generated, 1);
  assert.equal(sends.length, 1);
  assert.equal(sends[0]?.recipient, 'ou-admin-1');
  assert.equal((await db.select().from(feishuInbox))[0]?.status, 'sent');
});

test('group, unknown identity, cross-app and revoked administrator messages cannot generate or send a report', isolated, async (t) => {
  const { db, client, service, audit } = await fixture(t);
  const sends = provider(t);
  const reporting = { buildReport: async () => { throw new Error('Must not generate'); } } as unknown as ReportingService;
  const inbox = new FeishuInboxService(db, service, new FeishuAssistantHandlers(reporting), audit);
  const group = event(); group.message.chat_type = 'group';
  assert.equal(await inbox.receive(DEFAULT_FEISHU_ASSISTANT_ID, 'app-fixture', group), false);
  assert.equal(await inbox.receive(DEFAULT_FEISHU_ASSISTANT_ID, 'app-fixture', event('汇报', 'ou-unknown')), false);
  assert.equal(await inbox.receive(DEFAULT_FEISHU_ASSISTANT_ID, 'other-app', event()), false);
  assert.equal(await inbox.receive(DEFAULT_FEISHU_ASSISTANT_ID, 'app-fixture', event()), true);
  await client.query("UPDATE users SET disabled_at=now() WHERE id='admin-1'");
  await inbox.drain();
  assert.equal(sends.length, 0);
  assert.equal((await db.select().from(feishuInbox))[0]?.status, 'failed');
});

test('inbox retries transient failures across restart and keeps the same provider UUID', isolated, async (t) => {
  const { db, client, service, audit } = await fixture(t);
  const sends = provider(t, 'ou-admin-1');
  const reporting = { buildReport: async () => report } as unknown as ReportingService;
  const first = new FeishuInboxService(db, service, new FeishuAssistantHandlers(reporting), audit);
  await first.receive(DEFAULT_FEISHU_ASSISTANT_ID, 'app-fixture', event());
  await first.drain();
  assert.equal((await db.select().from(feishuInbox))[0]?.status, 'retryable');
  await client.query("UPDATE feishu_inbox SET updated_at=now()-interval '1 minute'");
  await new FeishuInboxService(db, service, new FeishuAssistantHandlers(reporting), audit).drain();
  assert.equal((await db.select().from(feishuInbox))[0]?.status, 'sent');
  assert.equal(sends.length, 2);
  assert.equal(sends[0]?.uuid, sends[1]?.uuid);
});

test('successful device authorization freezes its assistant and binds only the scanning administrator', isolated, async (t) => {
  const { service, client } = await fixture(t);
  let scanningOpenId = 'ou-new-admin';
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    const body = String(options?.body);
    if (body === 'action=init') return Response.json({ supported_auth_methods: ['client_secret'] });
    if (body.startsWith('action=begin')) return Response.json({ device_code: 'device-fixture', verification_uri_complete: 'https://open.feishu.cn/page/launcher?user_code=fixture', expires_in: 600, interval: 5 });
    return Response.json({ client_id: 'new-app-fixture', client_secret: 'new-secret-fixture', user_info: { open_id: scanningOpenId, tenant_brand: 'feishu' } });
  });
  const started = await service.beginDeviceAuthorization(admin);
  assert.equal((await service.pollDeviceAuthorization(started.id, admin)).status, 'bound');
  assert.equal((await service.getSettings()).appId, 'new-app-fixture');
  assert.deepEqual((await service.getSettings()).reportRecipients, ['ou-new-admin']);
  assert.equal((await service.resolveRecipientAdmin(DEFAULT_FEISHU_ASSISTANT_ID, 'ou-new-admin')).id, admin.id);
  const bindings = (await client.query('SELECT * FROM feishu_admin_bindings')).rows;
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].assistant_id, DEFAULT_FEISHU_ASSISTANT_ID);
  assert.equal(JSON.stringify(bindings).includes('ou-new-admin'), false);
  scanningOpenId = 'ou-rebound-admin';
  const rebound = await service.beginDeviceAuthorization(admin);
  assert.equal((await service.pollDeviceAuthorization(rebound.id, admin)).status, 'bound');
  assert.deepEqual((await service.getSettings()).reportRecipients, ['ou-rebound-admin']);
  assert.equal((await service.resolveRecipientAdmin(DEFAULT_FEISHU_ASSISTANT_ID, scanningOpenId)).id, admin.id);
});

test('assistant binding and credential replacement stay isolated and revoke old channel identities', isolated, async (t) => {
  const { service, client } = await fixture(t);
  const updated = await service.update(admin, { appId: 'other-app', appSecret: 'other-secret', reportAssistantId: 'assistant-other', enabled: true }, 'assistant-other');
  assert.equal(updated.assistantId, 'assistant-other');
  assert.equal(updated.inboundEnabled, false);
  assert.equal((await service.getSettings()).appId, 'app-fixture');
  assert.equal(JSON.stringify(updated).includes('other-secret'), false);
  await service.update(admin, { appId: 'replacement-app' });
  assert.deepEqual((await service.getSettings()).reportRecipients, []);
  assert.equal((await client.query('SELECT * FROM feishu_admin_bindings')).rows.length, 0);
});

test('bridge opens a socket per assistant, rotates credentials and closes revoked connections', isolated, async (t) => {
  const { db, client } = await fixture(t);
  const sockets: Array<{ closed: boolean; appId: string }> = [];
  const factory: FeishuSocketFactory = { create: (input) => {
    const socket = { closed: false, appId: input.appId }; sockets.push(socket);
    return { start: async () => {}, close: () => { socket.closed = true; }, state: () => 'connected' };
  } };
  const inbox = { receive: async () => true } as unknown as FeishuInboxService;
  const bridge = new FeishuBridgeService(db, factory, inbox);
  t.after(() => bridge.onModuleDestroy());
  await bridge.reconcile();
  assert.equal((await bridge.status(DEFAULT_FEISHU_ASSISTANT_ID)).state, 'connected');
  await client.query('INSERT INTO feishu_bots (id,assistant_id,enabled,inbound_enabled,app_id,app_secret_encrypted) VALUES ($1,$2,true,true,$3,$4)', ['bot-other', 'assistant-other', 'app-other', encryptModelSecret('other-secret', key)]);
  await bridge.reconcile();
  assert.equal(sockets.length, 2);
  await client.query('UPDATE feishu_bots SET app_secret_encrypted=$1 WHERE id=$2', [encryptModelSecret('rotated-secret', key), 'bot-fixture']);
  await bridge.reconcile();
  assert.equal(sockets[0]?.closed, true);
  assert.equal(sockets.length, 3);
  await client.query("UPDATE feishu_bots SET enabled=false WHERE id='bot-other'");
  await bridge.reconcile();
  assert.equal(sockets[1]?.closed, true);
  assert.equal((await bridge.status('assistant-other')).state, 'stopped');
  await client.query("UPDATE feishu_bots SET enabled=true,app_id='app-fixture' WHERE id='bot-other'");
  await bridge.reconcile();
  assert.equal((await bridge.status('assistant-other')).errorCode, 'FEISHU_APP_BOUND_MULTIPLE_ASSISTANTS');
  assert.equal((await bridge.status(DEFAULT_FEISHU_ASSISTANT_ID)).state, 'error');
});
