import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../services/api/package.json', import.meta.url));

/** Runs only inside test-business-postgres's disposable, loopback-only database. */
export async function verifyCompanyCommerce({ db, client, store, business, orders, payment, audit, load, check, admin, parent, other }) {
  const { CommerceService } = await load('business/commerce.service.js');
  const { CommerceAccess } = await load('business/commerce.access.js');
  const { CompanyAccess } = await load('company/company.access.js');
  const { CompanyData } = await load('company/company.data.js');
  const { CompanyWorkService } = await load('company/company.work.js');
  const commerce = new CommerceService(store, business, payment), access = new CommerceAccess(store, commerce);
  const companyAccess = new CompanyAccess(store);
  const registry = { listAssistants: async () => [{ id: 'fixture-company', name: '隔离测试助手', enabled: true }], getAssistantRuntime: async () => ({ agent: { enabled: true, modelProviderId: 'fixture-provider', modelId: 'fixture-model', modelUsage: 'admin.copilot', roleDefinition: '测试分析', agentDefinition: '' }, skills: [] }) };
  const companyData = new CompanyData(store, companyAccess, commerce, registry, audit, 'test');
  const gateway = { complete: async (_usage, request, selection) => {
    assert.equal(selection.providerId, 'fixture-provider'); assert.deepEqual(request.tools, []);
    assert.ok(!JSON.stringify(request).includes('password_hash'));
    return { text: '隔离测试分析成果：数据口径已注明，无外部操作。', providerId: 'fixture-provider', modelId: 'fixture-model' };
  } };
  const work = new CompanyWorkService(store, companyAccess, companyData, registry, gateway, audit);
  const target = 'commerce-student';
  await client.query(`ALTER TABLE project_template_versions ADD COLUMN IF NOT EXISTS content jsonb DEFAULT '{}';
    INSERT INTO users(id,email,display_name,role,password_hash) VALUES ('commerce-student','commerce@example.test','合成订阅学生','student','fixture'),('free-student','free@example.test','合成免费学生','student','fixture');
    INSERT INTO guardian_links(id,parent_user_id,student_user_id,relationship,status) VALUES ('commerce-link','parent','commerce-student','guardian','active');
    INSERT INTO project_templates(id,title,status,school_id) VALUES ('short-template','合成短课','published',NULL);
    INSERT INTO project_template_versions(id,template_id,version,status,content) VALUES ('short-version','short-template','v1','published','{"pbl":{"schedules":[{"lessonCount":1,"lessonMinutes":25}]}}');
    INSERT INTO pbl_template_team_bindings(id,template_version_id,status) VALUES ('short-binding','short-version','active');`);
  let trial, month, pilot, trialOrder, monthOrder, orgOrder;
  const input = product => ({ productId: product.id, productRevision: product.revision, settingsRevision: 1, studentId: target, acceptedTerms: true, guardianConsent: true });
  const pay = order => orders.acceptPayment({ orderId: order.id, amountFen: order.amountFen, transactionId: `commerce-${order.id}`, paidAt: new Date().toISOString() });

  await check('subscriptions stay disabled until explicitly configured; conditional annual products cannot publish', async () => {
    assert.equal((await commerce.catalog()).policy.enabled, false);
    await assert.rejects(() => commerce.saveProduct(admin, 'year-invalid', { id: 'year', revision: 0, status: 'published', templateVersionIds: ['version'] }));
    await assert.rejects(() => commerce.saveProduct(admin, 'trial-long-invalid', { id: 'trial', revision: 0, status: 'published', templateVersionIds: ['version'] }));
    trial = await commerce.saveProduct(admin, 'trial-publish', { id: 'trial', revision: 0, status: 'published', templateVersionIds: ['short-version'] });
    month = await commerce.saveProduct(admin, 'month-publish', { id: 'month', revision: 0, status: 'published', templateVersionIds: ['version', 'short-version'] });
    pilot = await commerce.saveProduct(admin, 'pilot-publish', { id: 'pilot', revision: 0, status: 'published', templateVersionIds: ['version'] });
    await commerce.savePolicy(admin, 'policy-enable', { revision: 0, enabled: true, freeTemplateVersionIds: ['short-version'] });
  });
  await check('trial purchase validates guardian; concurrent keys allocate only one pending order', async () => {
    await assert.rejects(() => commerce.createOrder(other, 'wrong-guardian', input(trial)));
    const created = await Promise.allSettled([commerce.createOrder(parent, 'trial-a', input(trial)), commerce.createOrder(parent, 'trial-b', input(trial))]);
    assert.equal(created.filter(r => r.status === 'fulfilled').length, 1); trialOrder = created.find(r => r.status === 'fulfilled').value;
    assert.equal(trialOrder.amountFen, 990);
    await Promise.all([pay(trialOrder), pay(trialOrder)]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM commerce_grants WHERE order_id=$1', [trialOrder.id])).rows[0].n, 1);
    await assert.rejects(() => commerce.createOrder(parent, 'trial-repeat', input(trial)));
  });
  await check('trial discount is server computed, charged once, and blocks independent source refund', async () => {
    monthOrder = await commerce.createOrder(parent, 'discount-month', input(month));
    assert.equal(monthOrder.amountFen, 38910); assert.equal(monthOrder.subscription.discountFen, 990);
    await assert.rejects(() => orders.requestRefund(parent, trialOrder.id, '合成退款', 'trial-refund-linked'));
    await pay(monthOrder);
    const replay = await commerce.createOrder(parent, 'discount-month', input(month)); assert.equal(replay.id, monthOrder.id);
    assert.equal((await access.account(target)).trialDiscountFen, 0);
  });
  await check('manual renewal queues after current service end and never reuses trial discount', async () => {
    const renewal = await commerce.createOrder(parent, 'renew-month', input(month)); assert.equal(renewal.amountFen, 39900); await pay(renewal);
    const current = await orders.owned(parent, monthOrder.id), next = await orders.owned(parent, renewal.id);
    assert.equal(next.serviceStartsAt.toISOString(), current.accessUntil.toISOString());
  });
  await check('free quota enforces 10 under concurrency and failed turns release a reservation', async () => {
    const results = await Promise.allSettled(Array.from({ length: 14 }, (_, i) => access.reserve('free-student', null, `free-${i}`)));
    const fulfilled = results.filter(r => r.status === 'fulfilled'); assert.equal(fulfilled.length, 10);
    await access.settle(fulfilled[0].value, false);
    const replacement = await access.reserve('free-student', null, 'replacement'); await access.settle(replacement, true);
    assert.equal(await access.reserve('free-student', null, 'replacement'), replacement);
    const account = await access.account('free-student'); const free = account.entitlements.find(e => e.source === 'free'); assert.equal(free.used, 1); assert.equal(free.reserved, 9);
  });
  await check('free project allowance is consumed once inside the project transaction', async () => {
    await db.transaction(tx => access.start('free-student', 'short-version', 'free-project-1', tx));
    await db.transaction(tx => access.start('free-student', 'short-version', 'free-project-1', tx));
    await assert.rejects(() => db.transaction(tx => access.start('free-student', 'short-version', 'free-project-2', tx)));
    await assert.rejects(() => db.transaction(tx => access.start('free-student', 'version', 'free-premium', tx)));
  });
  await check('parallel project transactions with student foreign keys serialize without lock upgrade deadlocks', async () => {
    await client.query(`ALTER TABLE projects ADD CONSTRAINT fixture_projects_student_fk FOREIGN KEY(student_user_id) REFERENCES users(id);
      INSERT INTO users(id,email,display_name,role,password_hash) VALUES ('free-racer','race-free@example.test','合成并发学生','student','fixture');`);
    const { sql } = require('drizzle-orm');
    const results = await Promise.allSettled([0, 1].map(i => db.transaction(async tx => {
      const projectId = `parallel-free-${i}`;
      await tx.execute(sql`INSERT INTO projects(id, student_user_id, template_version_id, status) VALUES (${projectId}, 'free-racer', 'short-version', 'active')`);
      await access.start('free-racer', 'short-version', projectId, tx);
    })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code !== '40P01'));
    assert.equal((await client.query("SELECT count(*)::int AS n FROM projects WHERE student_user_id='free-racer'")).rows[0].n, 1);
  });
  await check('organization payment creates 30-seat contract and student quota does not combine with personal quota', async () => {
    const org = await commerce.createOrganization(admin, 'org-create', { name: '合成试点机构' });
    orgOrder = await commerce.createOrder(admin, 'org-order', { productId: pilot.id, productRevision: pilot.revision, settingsRevision: 1, organizationId: org.id, seats: 30, acceptedTerms: true, guardianConsent: true });
    assert.equal(orgOrder.studentId, null); assert.equal(orgOrder.amountFen, 298000); await pay(orgOrder);
    const seat = await commerce.assignSeat(admin, 'org-seat', { orderId: orgOrder.id, studentId: target });
    assert.equal(seat.product.quota, 100);
    await commerce.assignSeat(admin, 'org-seat-again', { orderId: orgOrder.id, studentId: target });
    assert.equal((await client.query('SELECT count(*)::int AS n FROM commerce_grants WHERE order_id=$1',[orgOrder.id])).rows[0].n, 1);
    await client.query("INSERT INTO projects(id,student_user_id,template_version_id,status) VALUES ('org-project','commerce-student','version','active')");
    await db.transaction(tx => access.start(target, 'version', 'org-project', tx));
    const usage = await access.reserve(target, 'org-project', 'org-request'); await access.settle(usage, true);
    const account = await access.account(target); assert.equal(account.entitlements.find(e => e.organizationId)?.used, 1); assert.equal(account.entitlements.find(e => e.source === 'month')?.used, 0);
  });
  await check('company object permissions, durable tasks, actual completion and cancellation', async () => {
    await assert.rejects(() => companyAccess.require(parent));
    await assert.rejects(() => companyAccess.require({ ...parent, id: target, role: 'student' }));
    await client.query("INSERT INTO company_members(user_id,role) VALUES ('parent','viewer')");
    assert.equal(await companyAccess.require(parent), 'viewer'); await assert.rejects(() => companyAccess.require(parent, 'operate'));
    await work.configure(admin, 'company-team', { department: 'data', assistantId: 'fixture-company', revision: 0, enabled: true });
    const task = await work.create(admin, 'company-task', { department: 'data', title: '合成经营分析', brief: '基于汇总数据列出待核实项' });
    assert.equal((await work.create(admin, 'company-task', { department: 'data', title: '合成经营分析', brief: '基于汇总数据列出待核实项' })).id, task.id);
    await Promise.all([work.drain(), work.drain()]);
    const row = (await client.query('SELECT * FROM company_work WHERE id=$1', [task.id])).rows[0]; assert.equal(row.status, 'succeeded'); assert.equal(row.attempts, 1); assert.ok(row.result.includes('隔离测试分析'));
    const cancelled = await work.create(admin, 'company-cancel', { department: 'data', title: '取消验证', brief: '此任务不执行' });
    await work.change(admin, 'company-cancel-action', cancelled.id, { action: 'cancel' }); await work.drain();
    assert.equal((await client.query('SELECT status FROM company_work WHERE id=$1', [cancelled.id])).rows[0].status, 'cancelled');
    const overview = await companyData.overview(parent); assert.ok(overview.metrics.revenueFen > 0); assert.equal(overview.assistants.length, 0);
  });
  await check('partial refund validates refunded fen and revokes only the corresponding grant', async () => {
    await client.query("UPDATE business_orders SET service_starts_at=now()-interval '15 days',access_until=now()+interval '15 days' WHERE id=$1", [monthOrder.id]);
    const requested = await orders.requestRefund(parent, monthOrder.id, '合成按未履行周期退款', 'month-refund');
    assert.ok(requested.refundAmountFen > 19000 && requested.refundAmountFen < 20000);
    await orders.approveRefund(admin, monthOrder.id, 'month-approve');
    await assert.rejects(() => orders.acceptRefund({ orderId: monthOrder.id, refundId: `rf${monthOrder.id}`, amountFen: 38910, status: 'SUCCESS' }));
    await orders.acceptRefund({ orderId: monthOrder.id, refundId: `rf${monthOrder.id}`, amountFen: requested.refundAmountFen, status: 'SUCCESS' });
    const rows = (await client.query('SELECT revoked_at FROM commerce_grants WHERE order_id=$1', [monthOrder.id])).rows; assert.ok(rows[0].revoked_at);
    assert.equal((await client.query('SELECT revoked_at FROM commerce_grants WHERE order_id=$1', [orgOrder.id])).rows[0].revoked_at, null);
  });
  await check('Feishu group routing binds app, group, sender and department; message retries create one task and receipt', async () => {
    await client.query(`CREATE TABLE feishu_bots(id text PRIMARY KEY, assistant_id text NOT NULL, enabled boolean DEFAULT false, inbound_enabled boolean DEFAULT false,
      app_id text, app_secret_encrypted text, verification_token_encrypted text, encrypt_key_encrypted text, domain text DEFAULT 'feishu', report_assistant_id text,
      report_recipients jsonb DEFAULT '[]', updated_by text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      INSERT INTO feishu_bots(id,assistant_id,app_id,enabled,inbound_enabled) VALUES ('fixture-bot','fixture-company','fixture-app',true,true);`);
    const { CompanyIntegrations } = await load('company/company.integrations.js');
    const sent = [];
    const integrations = new CompanyIntegrations(store, companyAccess, work, { registerCompanyReceiver() {} }, {
      sendCompanyStatus: async (channel, text, key) => { sent.push({ channel, text, key }); return { messageId: 'fixture-receipt' }; },
    }, { status: async () => ({ state: 'stopped' }) }, audit);
    const binding = { assistantId: 'fixture-company', appId: 'fixture-app', chatId: 'fixture-group', senderOpenId: 'fixture-sender', userId: admin.id, department: 'data', active: true };
    await integrations.bind(admin, 'feishu-bind', binding);
    const message = (chatId = 'fixture-group', sender = 'fixture-sender') => ({ header: { app_id: 'fixture-app' }, event: { sender: { sender_type: 'user', sender_id: { open_id: sender } }, message: {
      chat_type: 'group', chat_id: chatId, message_type: 'text', message_id: 'fixture-message', content: JSON.stringify({ text: '/company data 请分析聚合经营数据' }),
    } } });
    assert.equal(await integrations.receive('fixture-company', 'fixture-app', message('other-group')), false);
    assert.equal(await integrations.receive('fixture-company', 'fixture-app', message(undefined, 'other-sender')), false);
    assert.equal(await integrations.receive('fixture-company', 'other-app', message()), false);
    assert.equal(await integrations.receive('fixture-company', 'fixture-app', message()), true);
    assert.equal(await integrations.receive('fixture-company', 'fixture-app', message()), true);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM company_messages')).rows[0].n, 1);
    await work.drain(); await integrations.deliver(); await integrations.deliver();
    assert.equal(sent.length, 1); assert.ok(!sent[0].text.includes('隔离测试分析成果'));
    assert.equal((await client.query('SELECT delivery FROM company_messages')).rows[0].delivery.messageId, 'fixture-receipt');
    await integrations.bind(admin, 'feishu-revoke', { ...binding, active: false });
    assert.equal(await integrations.receive('fixture-company', 'fixture-app', message()), false);
  });
  return { commerce, access, companyAccess, companyData, work, registry, gateway };
}
