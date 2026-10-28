import { verifyCompanyCommerce } from './test-company-commerce-postgres.mjs';
import { verifyAccountRegistration } from './test-account-registration-postgres.mjs';
import { FixtureRegistrationSms, verifyRegistrationSms } from './test-registration-sms-postgres.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../services/api/package.json', import.meta.url));
require('reflect-metadata');
const { Client } = require('pg');
const report = JSON.parse(
  readFileSync(join(root, 'services/api/.tmp/company-verification.json'), 'utf8'),
);
process.env.QITU_SOURCE_RUN_ID = report.runId;
await import('./verify-workspace-source.mjs');
const base = process.env.QITU_BUSINESS_FIXTURE_URL;
assert.ok(base, 'Set an isolated local QITU_BUSINESS_FIXTURE_URL');
const baseUrl = new URL(base);
assert.ok(
  ['127.0.0.1', 'localhost'].includes(baseUrl.hostname) && baseUrl.port !== '5432',
  'Only a dedicated local fixture server is allowed',
);
const databaseName = `qitu_business_fixture_${Date.now()}`;
const control = new Client({ connectionString: base });
await control.connect();
await control.query(`CREATE DATABASE ${databaseName}`);
const fixtureUrl = new URL(base);
fixtureUrl.pathname = `/${databaseName}`;
const client = new Client({ connectionString: fixtureUrl.href });
await client.connect();
const modules = join(report.directory, 'dist/modules');
const load = (name) => import(pathToFileURL(join(modules, name)).href);
const { createDb, closeDb, withTransaction } = await import('@qitu/database');
let db;
const checks = [];
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  process.stdout.write(`PASS ${name}\n`);
};
try {
  await client.query(`
    CREATE TABLE schools(id text PRIMARY KEY,status text);
    CREATE TABLE users(id text PRIMARY KEY,email text NOT NULL,display_name text NOT NULL,role text NOT NULL,password_hash text NOT NULL,school_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),disabled_at timestamptz);
    CREATE UNIQUE INDEX users_email_lower_idx ON users(lower(email));
    CREATE TABLE guardian_links(id text PRIMARY KEY,parent_user_id text REFERENCES users(id),student_user_id text REFERENCES users(id),relationship text,status text,created_at timestamptz DEFAULT now(),ended_at timestamptz);
    CREATE TABLE project_templates(id text PRIMARY KEY,title text,status text,school_id text);
    CREATE TABLE project_template_versions(id text PRIMARY KEY,template_id text REFERENCES project_templates(id),version text,status text);
    CREATE TABLE pbl_template_team_bindings(id text PRIMARY KEY,template_version_id text REFERENCES project_template_versions(id),status text);
    CREATE TABLE projects(id text PRIMARY KEY,student_user_id text,template_version_id text,status text,created_at timestamptz DEFAULT now());
    CREATE TABLE consultation_requests(id text PRIMARY KEY,name text,phone text,identity text,message text,status text,source text,idempotency_key text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),contacted_at timestamptz);
    CREATE TABLE model_providers(id text PRIMARY KEY,name text);
    CREATE TABLE audit_logs(id text PRIMARY KEY,actor_id text,action text,target_type text,target_id text,detail jsonb,idempotency_key text UNIQUE,at timestamptz DEFAULT now());
    CREATE TABLE idempotency_keys(id text PRIMARY KEY,scope text,key text,request_hash text,status text,response_status integer,response_body jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),expires_at timestamptz,UNIQUE(scope,key));
  `);
  await client.query(
    readFileSync(join(root, 'database/migrations/0054_business_operations.sql'), 'utf8'),
  );
  await client.query(readFileSync(join(root, 'database/migrations/0055_phone_registration.sql'), 'utf8'));
  await client.query(readFileSync(join(root, 'database/migrations/0056_company_commerce.sql'), 'utf8'));
  await client.query(`INSERT INTO users(id,email,display_name,role,password_hash) VALUES ('admin','admin@example.test','测试管理员','admin','fixture'),('parent','parent@example.test','测试家长','parent','fixture'),('other','other@example.test','另一家庭','parent','fixture'),('student','student@example.test','测试学生','student','fixture');
    INSERT INTO guardian_links(id,parent_user_id,student_user_id,relationship,status) VALUES ('link','parent','student','guardian','active');
    INSERT INTO project_templates VALUES ('template','测试课程','published',NULL);
    INSERT INTO project_template_versions VALUES ('version','template','v1','published');
    INSERT INTO pbl_template_team_bindings VALUES ('binding','version','active');`);
  db = createDb(fixtureUrl.href);
  const { AuditService } = await import(
    pathToFileURL(join(report.directory, 'dist/common/audit/audit.service.js')).href
  );
  const { IdempotencyService } = await import(
    pathToFileURL(join(report.directory, 'dist/common/idempotency/idempotency.service.js')).href
  );
  const { DirectoryService } = await load('directory/directory.service.js');
  const { BusinessStore } = await load('business/business.store.js');
  const { BusinessService } = await load('business/business.service.js');
  const { BusinessOrders } = await load('business/business.orders.js');
  const { BusinessReporting } = await load('business/business.reporting.js');
  const { BusinessAutomation } = await load('business/business.automation.js');
  const { BusinessAccess } = await load('business/business.access.js');
  const { WechatPayment } = await load('business/wechat-payment.js');
  const { EMPTY_BUSINESS_SETTINGS } = await load('business/business.validation.js');
  class FixturePayment extends WechatPayment {
    configured = true;
    closeFails = false;
    status() {
      return { configured: this.configured, provider: 'wechat-native', reason: 'isolated fixture' };
    }
    async create() {
      return 'weixin://wxpay/fixture';
    }
    async query() {
      return null;
    }
    async close() {
      if (this.closeFails) throw new Error('synthetic close timeout');
    }
    async refund(order) {
      return {
        orderId: order.id,
        refundId: order.refundId,
        amountFen: order.refundFen ?? order.amountFen,
        status: 'PROCESSING',
      };
    }
  }
  const audit = new AuditService(db);
  const idempotency = new IdempotencyService(db);
  const store = new BusinessStore(db, audit, idempotency);
  const payment = new FixturePayment();
  const directory = new DirectoryService('test', db, withTransaction);
  const business = new BusinessService(store, directory, payment);
  const orders = new BusinessOrders(store, business, payment, audit);
  const reports = new BusinessReporting(store, payment, audit);
  const automation = new BusinessAutomation(store, audit);
  const access = new BusinessAccess(db);
  const admin = {
    id: 'admin',
    role: 'admin',
    email: 'admin@example.test',
    displayName: '测试管理员',
  };
  const parent = {
    id: 'parent',
    role: 'parent',
    email: 'parent@example.test',
    displayName: '测试家长',
  };
  const other = { ...parent, id: 'other' };
  let settings;
  let offer;
  let order;
  await check('settings revision, published offer and current template binding', async () => {
    settings = await business.saveSettings(admin, 'settings-1', {
      ...EMPTY_BUSINESS_SETTINGS,
      operatorName: '隔离测试主体',
      supportEmail: 'support@example.test',
      registrationInfo: '隔离测试，非真实经营资质',
      privacyText: '隔离测试隐私说明。'.repeat(10),
      termsText: '隔离测试服务条款。'.repeat(10),
      refundText: '隔离测试退款规则，合成数据不产生真实资金交易。',
      salesEnabled: true,
    });
    await assert.rejects(() =>
      business.saveSettings(admin, 'settings-stale', { ...settings, revision: 0 }),
    );
    offer = await business.saveOffer(admin, 'offer-1', {
      id: '',
      revision: 0,
      templateVersionId: 'version',
      title: '隔离测试项目包',
      summary: '仅作工程验证',
      audience: '合成测试账号',
      outcomes: ['合成观察报告'],
      priceFen: 19900,
      accessDays: 30,
      requiresPurchase: true,
      status: 'published',
    });
    assert.equal((await business.catalog()).offers.length, 1);
    await assert.rejects(() =>
      business.saveOffer(admin, 'offer-wrong-version', {
        ...offer,
        templateVersionId: 'other-version',
      }),
    );
    await assert.rejects(() => access.assertCanStart('student', 'version'));
  });
  const input = () => ({
    offerId: offer.id,
    offerRevision: offer.revision,
    settingsRevision: settings.revision,
    studentId: 'student',
    acceptedTerms: true,
    guardianConsent: true,
  });
  await check(
    'orders enforce guardian ownership, frozen price and durable idempotency',
    async () => {
      await assert.rejects(() => business.createOrder(other, 'wrong-family', input()));
      order = await business.createOrder(parent, 'order-1', input());
      assert.match(order.id, /^[a-f0-9]{32}$/);
      assert.equal(order.amountFen, 19900);
      assert.equal((await business.createOrder(parent, 'order-1', input())).id, order.id);
      await assert.rejects(() => business.createOrder(parent, 'order-2', input()));
      await assert.rejects(() => orders.owned(other, order.id));
      const checkout = await orders.checkout(parent, order.id, 'checkout-1');
      assert.ok(checkout.checkoutUrl);
      assert.equal(
        Number((await client.query('SELECT count(*) FROM business_orders')).rows[0].count),
        1,
      );
    },
  );
  const fact = () => ({
    orderId: order.id,
    transactionId: 'synthetic-trade',
    amountFen: 19900,
    paidAt: new Date().toISOString(),
  });
  await check(
    'only matching signed-payment facts grant access, duplicate receipts audit once',
    async () => {
      await assert.rejects(() => orders.acceptPayment({ ...fact(), amountFen: 1 }));
      await orders.acceptPayment(fact());
      await orders.acceptPayment(fact());
      assert.equal((await business.orders(parent, 'student'))[0].status, 'paid');
      await access.assertCanStart('student', 'version');
      assert.equal(
        Number(
          (
            await client.query(
              "SELECT count(*) FROM audit_logs WHERE action='business.payment.verified'",
            )
          ).rows[0].count,
        ),
        1,
      );
      assert.equal(Number((await client.query('SELECT count(*) FROM projects')).rows[0].count), 0);
    },
  );
  await check(
    'refunds remain processing until verified, then revoke new-project access',
    async () => {
      await orders.requestRefund(parent, order.id, '合成退款申请', 'refund-1');
      assert.equal((await orders.approveRefund(admin, order.id, 'approve-1')).status, 'refunding');
      await orders.acceptRefund({
        orderId: order.id,
        refundId: `rf${order.id}`,
        amountFen: 19900,
        status: 'SUCCESS',
      });
      await orders.acceptRefund({
        orderId: order.id,
        refundId: `rf${order.id}`,
        amountFen: 19900,
        status: 'SUCCESS',
      });
      await assert.rejects(() => access.assertCanStart('student', 'version'));
      assert.equal((await business.orders(parent, 'student'))[0].status, 'refunded');
    },
  );
  await check('revoked guardian link denies read immediately', async () => {
    await client.query("UPDATE guardian_links SET status='ended' WHERE id='link'");
    await assert.rejects(() => business.orders(parent, 'student'));
    await client.query("UPDATE guardian_links SET status='active' WHERE id='link'");
  });
  await check('expired orders block replacements until merchant closure is verified', async () => {
    const pending = await business.createOrder(parent, 'expired-1', input());
    await client.query(
      "UPDATE business_orders SET checkout_expires_at=now()-interval '1 minute' WHERE id=$1",
      [pending.id],
    );
    await assert.rejects(() => business.createOrder(parent, 'replacement-before-close', input()));
    payment.closeFails = true;
    await assert.rejects(() => orders.reconcile(parent, pending.id));
    assert.equal((await orders.owned(parent, pending.id)).status, 'pending');
    payment.closeFails = false;
    assert.equal((await orders.reconcile(parent, pending.id)).status, 'cancelled');
    await assert.rejects(() => new BusinessAccess(null).assertCanStart('student', 'version'));
  });
  await check(
    'operating checks persist one task per reference and lead handling resolves it',
    async () => {
      await client.query(
        "INSERT INTO consultation_requests(id,name,phone,identity,status,created_at) VALUES ('lead','合成咨询','13800000000','parent','received',now()-interval '2 days')",
      );
      assert.equal((await automation.run(true, admin)).created, 1);
      assert.equal((await automation.run(true, admin)).created, 0);
      await reports.updateLead(admin, 'contact-1', 'lead', 'contacted');
      assert.equal((await reports.dashboard(admin)).tasks.length, 0);
    },
  );
  await check(
    'cost ledger is idempotent and never invents profitability or learning completions',
    async () => {
      const expense = {
        category: 'support',
        amountFen: 200,
        minutes: 15,
        note: '合成客服工时',
        orderId: order.id,
      };
      await reports.recordExpense(admin, 'cost-1', expense);
      await reports.recordExpense(admin, 'cost-1', expense);
      await assert.rejects(() =>
        reports.recordExpense(admin, 'cost-1', { ...expense, amountFen: 300 }),
      );
      const dashboard = await reports.dashboard(admin);
      assert.equal(dashboard.metrics.recordedExpenseFen, 200);
      assert.equal(dashboard.metrics.supportMinutes, 15);
      assert.equal(dashboard.metrics.learningCompleted, 0);
      assert.equal(dashboard.metrics.refundedFen, 19900);
      assert.equal(dashboard.metrics.modelCalls, 0);
    },
  );
  await verifyAccountRegistration({ db, client, audit, idempotency, directory, load, check });
  await verifyRegistrationSms({ db, client, audit, idempotency, directory, load, check });
  const companyFixture = await verifyCompanyCommerce({ db, client, store, business, orders, payment, audit, load, check, admin, parent, other });
  writeFileSync(
    join(root, 'services/api/.tmp/company-postgres-results.json'),
    JSON.stringify(
      { success: true, runId: report.runId, checks, isolated: true, actualPayments: false },
      null,
      2,
    ),
  );
  if (process.argv.includes('--serve')) {
    // Explicit synthetic preview. No production DB, models or merchant requests.
    process.env.DATABASE_URL = fixtureUrl.href;
    process.env.QITU_DATA_MODE = 'test';
    process.env.NODE_ENV = 'development';
    delete process.env.REDIS_URL;
    const password = 'FixtureOnly-2026-password';
    await client.query(
      "UPDATE users SET password_hash=$1 WHERE id IN ('admin','parent','other','student')",
      [createHash('sha256').update(password).digest('hex')],
    );
    await client.query(
      "INSERT INTO consultation_requests(id,name,phone,identity,status,created_at,message) VALUES ('preview-lead','合成体验咨询','13800000001','parent','received',now()-interval '2 days','希望了解光学项目的学习安排')",
    );
    await automation.run(true, admin);
    const { NestFactory } = require('@nestjs/core');
    const { Module } = require('@nestjs/common');
    const { DatabaseModule } = await import(
      pathToFileURL(join(report.directory, 'dist/database/index.js')).href
    );
    const { AuditModule } = await import(
      pathToFileURL(join(report.directory, 'dist/common/audit/audit.module.js')).href
    );
    const { IdempotencyModule } = await import(
      pathToFileURL(join(report.directory, 'dist/common/idempotency/idempotency.module.js')).href
    );
    const { RedisModule } = await import(
      pathToFileURL(join(report.directory, 'dist/common/redis/redis.module.js')).href
    );
    const { HealthModule } = await import(
      pathToFileURL(join(report.directory, 'dist/health/health.module.js')).href
    );
    const { AuthModule } = await load('identity-auth/auth.module.js');
    const { DirectoryModule } = await load('directory/directory.module.js');
    const { BusinessController } = await load('business/business.controller.js');
    const { CommerceController } = await load('business/commerce.controller.js');
    const { CommerceService } = await load('business/commerce.service.js');
    const { CommerceAccess } = await load('business/commerce.access.js');
    const { CompanyController } = await load('company/company.controller.js');
    const { CompanyAccess } = await load('company/company.access.js');
    const { CompanyData } = await load('company/company.data.js');
    const { CompanyWorkService } = await load('company/company.work.js');
    const { CompanyIntegrations } = await load('company/company.integrations.js');
    const integrationFixture = { list: async () => ({ channels: [], bots: [] }), bind: async () => { throw new Error('No external Feishu in isolated preview'); } };
    const { BusinessUsage } = await load('business/business.usage.js');
    const { AccountRegistrationService } = await load('directory/account-registration.service.js');
    const { RegistrationSmsService } = await load('directory/registration-sms.service.js');
    const { AliyunRegistrationSms } = await load('directory/aliyun-registration-sms.js');
    const fixtureSms = new FixtureRegistrationSms();
    process.env.QITU_SMS_VERIFICATION_KEY = randomBytes(32).toString('hex');
    class PreviewPayment extends FixturePayment {
      async query(id) {
        const row = (await client.query('SELECT amount_fen FROM business_orders WHERE id=$1', [id]))
          .rows[0];
        return row
          ? {
              orderId: id,
              transactionId: `preview-${id}`,
              amountFen: row.amount_fen,
              paidAt: new Date().toISOString(),
            }
          : null;
      }
    }
    class PreviewModule {}
    Module({
      imports: [
        DatabaseModule,
        AuditModule,
        IdempotencyModule,
        RedisModule,
        HealthModule,
        AuthModule,
        DirectoryModule,
      ],
      controllers: [BusinessController, CommerceController, CompanyController],
      providers: [
        BusinessStore,
        BusinessService,
        BusinessOrders,
        BusinessReporting,
        BusinessAutomation,
        BusinessUsage,
        BusinessAccess,
        CommerceService,
        CommerceAccess,
        { provide: CompanyAccess, useValue: companyFixture.companyAccess },
        { provide: CompanyData, useValue: companyFixture.companyData },
        { provide: CompanyWorkService, useValue: companyFixture.work },
        { provide: CompanyIntegrations, useValue: integrationFixture },
        AccountRegistrationService,
        RegistrationSmsService,
        { provide: AliyunRegistrationSms, useValue: fixtureSms },
        { provide: WechatPayment, useClass: PreviewPayment },
      ],
    })(PreviewModule);
    const app = await NestFactory.create(PreviewModule, { logger: ['error', 'warn'] });
    const { ProblemDetailsFilter } = await import(pathToFileURL(join(report.directory, 'dist/common/http/problem-details.filter.js')).href);
    app.useGlobalFilters(new ProblemDetailsFilter());
    app.setGlobalPrefix('api/v1');
    app.use((request, response, next) => {
      // Test runner only, bound to loopback and backed by this disposable database.
      if (request.path === '/api/v1/fixture/sms-code')
        return response.json({ code: fixtureSms.codes.get(String(request.query.phone)) ?? null });
      if (request.path === '/api/v1/public/home')
        return response.json({
          data: {
            stats: { learners: 0, schools: 0, publishedTemplates: 0, publishedWorks: 0 },
            templates: [],
            generatedAt: new Date().toISOString(),
          },
        });
      if (request.path === '/api/v1/parent/children')
        return response.json({ data: [{ childId: 'student', displayName: '隔离测试学生' }] });
      if (request.path === '/api/v1/parent/children/student/dashboard')
        return response.json({
          data: {
            dataSource: 'live',
            kpis: [],
            hasAnyProject: false,
            currentProject: null,
            attention: [],
            weeklySummary: { completed: [], praised: [], next: [] },
            recentArtifacts: [],
          },
        });
      return next();
    });
    await app.listen(4714, '127.0.0.1');
    process.stdout.write('Synthetic preview API listening on 127.0.0.1:4714\n');
    await new Promise((resolveSignal) => {
      process.once('SIGINT', resolveSignal);
      process.once('SIGTERM', resolveSignal);
    });
    await app.close();
  }
} finally {
  if (db) await closeDb(db);
  await client.end();
  await control.query(`DROP DATABASE ${databaseName}`);
  await control.end();
}
