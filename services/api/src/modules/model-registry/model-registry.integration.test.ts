import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { eq, inArray, like } from 'drizzle-orm';
import {
  auditLogs,
  createDb,
  modelModels,
  modelProviders,
  modelUsageBindings,
  type Database,
} from '@qitu/database';
import { AuditService } from '../../common/audit';
import { decryptModelSecret, fingerprintModelSecret } from '../../common/secrets';
import { ModelRegistryService } from './model-registry.service';
import { upsertManualModelRow } from './model-registry.persistence';

/**
 * 针对真实 PostgreSQL（独立 `qitu_test` 库）的模型注册表持久化验证。
 *
 * 覆盖：
 * - 供应商 / 密钥落库后**重启式新实例**能完整恢复；
 * - 密钥密文非明文、可用主密钥解密；缺主密钥时 live 写入 503 且不落任何行；
 * - 自动拉取远程模型、软下线未返回的模型、手工模型不被误删；
 * - 拉取失败保留旧列表并写 `last_error`；
 * - 用途绑定持久化、模态 / 不存在 / 已下线模型校验、`fallbackTo`、解绑；
 * - 删除供应商时显式解绑并清理其模型；
 * - 审计写入 upsert / delete / bind / unbind / refresh 且不含明文密钥。
 *
 * - **只有 `DATABASE_URL` 存在时才运行**；未设置则整组 skip。
 * - `DATABASE_URL` / `QITU_MODEL_SECRET_KEY` 只从进程环境读取，**不写入任何文件**。
 *
 *   cd services/api
 *   npx tsc -p tsconfig.json
 *   DATABASE_URL='postgres://...' node --test dist/modules/model-registry/model-registry.integration.test.js
 */

const connectionString = process.env.DATABASE_URL;
const skip = connectionString ? false : 'DATABASE_URL 未设置：跳过真实数据库模型注册表集成测试';

const DATABASE_URL_ENV = 'DATABASE_URL';
const SECRET_ENV = 'QITU_MODEL_SECRET_KEY';

/** 每个测试用的 32 字节主密钥（64 位 hex），测试内注入环境变量，不落盘。 */
const TEST_SECRET_KEY_HEX = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
const TEST_SECRET_KEY = Buffer.from(TEST_SECRET_KEY_HEX, 'hex');

describe('ModelRegistryService（真实 PostgreSQL）', { skip }, () => {
  let db: Database;
  let audit: AuditService;
  let server: Server;
  /** 可变的假上游模型清单。 */
  let upstreamModels: { id: string }[] = [];

  // 本次运行独占前缀；只清理自己写的行，不打扰共享 qitu_test。
  const RUN = `itest-${randomUUID()}`;
  const providerId = (name: string) => `${RUN}-${name}`;
  const restoredEnv: Record<string, string | undefined> = {};

  before(async () => {
    restoredEnv[DATABASE_URL_ENV] = process.env[DATABASE_URL_ENV];
    restoredEnv[SECRET_ENV] = process.env[SECRET_ENV];
    process.env[SECRET_ENV] = TEST_SECRET_KEY_HEX;

    db = createDb(connectionString!);
    audit = new AuditService(db);

    server = createServer((req, res) => {
      if ((req.url ?? '').endsWith('/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: upstreamModels }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    const ids = await db
      .select({ id: modelProviders.id })
      .from(modelProviders)
      .where(like(modelProviders.id, `${RUN}%`));
    const idList = ids.map((row) => row.id);
    if (idList.length > 0) {
      await db.delete(modelUsageBindings).where(inArray(modelUsageBindings.providerId, idList));
      await db.delete(modelModels).where(inArray(modelModels.providerId, idList));
      await db.delete(modelProviders).where(inArray(modelProviders.id, idList));
    }
    // 审计行按 actorId（本次 RUN）清理，保持共享测试库干净。
    await db.delete(auditLogs).where(eq(auditLogs.actorId, RUN));

    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (restoredEnv[SECRET_ENV] === undefined) delete process.env[SECRET_ENV];
    else process.env[SECRET_ENV] = restoredEnv[SECRET_ENV];
    if (restoredEnv[DATABASE_URL_ENV] === undefined) delete process.env[DATABASE_URL_ENV];
    else process.env[DATABASE_URL_ENV] = restoredEnv[DATABASE_URL_ENV];

    const pool = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (typeof pool?.end === 'function') await pool.end();
  });

  /** 模拟 API 重启：全新实例 + onModuleInit 从库中水合。 */
  async function freshService(): Promise<ModelRegistryService> {
    const service = new ModelRegistryService(db, audit);
    await service.onModuleInit();
    return service;
  }

  function serverBaseUrl(): string {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('测试服务器未监听');
    return `http://127.0.0.1:${address.port}`;
  }

  test('供应商 + 密钥落库后可被新实例恢复，且密文非明文', async () => {
    const id = providerId('crud');
    const secret = 'sk-live-crud-secret-42';
    const service = await freshService();

    const created = await service.upsertProvider(
      id,
      { name: '测试供应商', baseUrl: 'https://gateway.example.com', api: 'openai-responses', apiKey: secret },
      RUN,
    );
    assert.equal(created.api, 'openai-responses');
    assert.equal(created.auth.configured, true);
    assert.equal(created.auth.keyFingerprint, fingerprintModelSecret(secret));
    assert.equal(created.updatedBy, RUN);

    const rows = await db.select().from(modelProviders).where(eq(modelProviders.id, id));
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]!.encryptedApiKey, null);
    assert.notEqual(rows[0]!.encryptedApiKey, secret);
    assert.ok(!rows[0]!.encryptedApiKey!.includes(secret), '库中密文不得包含明文');
    assert.equal(rows[0]!.keyFingerprint, fingerprintModelSecret(secret));
    assert.equal(
      decryptModelSecret(rows[0]!.encryptedApiKey!, TEST_SECRET_KEY),
      secret,
      '可用主密钥解回明文',
    );

    const restarted = await freshService();
    const restored = restarted.listProviders().providers.find((provider) => provider.id === id);
    assert.ok(restored, '重启后应能读到该供应商');
    assert.equal(restored!.name, '测试供应商');
    assert.equal(restored!.baseUrl, 'https://gateway.example.com');
    assert.equal(restored!.api, 'openai-responses');
    assert.equal(restored!.auth.configured, true);
    assert.equal(restored!.auth.keyFingerprint, fingerprintModelSecret(secret));
  });

  test('缺主密钥时 live 写入 apiKey 抛 503，且不落任何半成品', async () => {
    const id = providerId('nokey');
    delete process.env[SECRET_ENV];
    const service = await freshService();

    await assert.rejects(
      () => service.upsertProvider(id, { baseUrl: 'https://x.example.com', apiKey: 'sk-should-not-persist' }, RUN),
      (error: unknown) => error instanceof ServiceUnavailableException,
    );

    const providers = await db.select().from(modelProviders).where(eq(modelProviders.id, id));
    assert.equal(providers.length, 0, '缺密钥时不得写入供应商行');
    const bindings = await db
      .select()
      .from(modelUsageBindings)
      .where(eq(modelUsageBindings.providerId, id));
    assert.equal(bindings.length, 0);

    process.env[SECRET_ENV] = TEST_SECRET_KEY_HEX;
  });

  test('主密钥格式非法时 live 写入 apiKey 也抛 503，不落明文', async () => {
    const id = providerId('badkey');
    process.env[SECRET_ENV] = 'not-a-valid-key';
    const service = await freshService();

    await assert.rejects(
      () => service.upsertProvider(id, { baseUrl: 'https://x.example.com', apiKey: 'sk-plain' }, RUN),
      (error: unknown) => error instanceof ServiceUnavailableException,
    );
    const rows = await db.select().from(modelProviders).where(eq(modelProviders.id, id));
    assert.equal(rows.length, 0);

    process.env[SECRET_ENV] = TEST_SECRET_KEY_HEX;
  });

  test('空串 apiKey 清除密钥且不报错', async () => {
    const id = providerId('clearkey');
    const service = await freshService();
    await service.upsertProvider(id, { baseUrl: 'https://clear.example.com', apiKey: 'sk-temp' }, RUN);
    const cleared = await service.upsertProvider(id, { apiKey: '' }, RUN);
    assert.equal(cleared.auth.configured, false);
    assert.equal(cleared.auth.keyFingerprint, null);

    const rows = await db.select().from(modelProviders).where(eq(modelProviders.id, id));
    assert.equal(rows[0]!.encryptedApiKey, null);
    assert.equal(rows[0]!.keyFingerprint, null);
  });

  test('自动拉取：远程 upsert、未返回模型软下线、手工模型不被误删', async () => {
    const id = providerId('refresh');
    upstreamModels = [{ id: 'remote-a' }, { id: 'remote-b' }];
    let service = await freshService();
    await service.upsertProvider(id, { name: '拉取', baseUrl: serverBaseUrl() }, RUN);

    // 直接往库里放一个手工模型，刷新时必须保留。
    await upsertManualModelRow(
      db,
      {
        providerId: id,
        modelId: 'manual-keep',
        displayName: '手工模型',
        input: ['text'],
        output: ['text'],
        contextWindow: null,
        maxTokens: null,
      },
      new Date(),
    );
    service = await freshService();

    const first = await service.refreshProvider(id, RUN);
    assert.equal(first.fetched, 2);
    let ids = first.provider.models.map((model) => model.id).sort();
    assert.deepEqual(ids, ['manual-keep', 'remote-a', 'remote-b']);

    // 第二次上游只返回 remote-a：remote-b 应软下线，手工模型仍在。
    upstreamModels = [{ id: 'remote-a' }];
    const second = await service.refreshProvider(id, RUN);
    assert.equal(second.fetched, 1);
    ids = second.provider.models.map((model) => model.id).sort();
    assert.deepEqual(ids, ['manual-keep', 'remote-a']);

    const modelRows = await db.select().from(modelModels).where(eq(modelModels.providerId, id));
    const remoteB = modelRows.find((row) => row.modelId === 'remote-b');
    assert.ok(remoteB, '软下线不物理删除行');
    assert.equal(remoteB!.enabled, false);
    assert.equal(remoteB!.source, 'remote');
    const manual = modelRows.find((row) => row.modelId === 'manual-keep');
    assert.equal(manual!.enabled, true, '手工模型不得被刷新下线');
    assert.equal(manual!.source, 'manual');

    // 新实例水合：软下线的远程模型不出现，手工模型出现。
    const restarted = await freshService();
    const restored = restarted.listProviders().providers.find((provider) => provider.id === id);
    assert.deepEqual(
      restored!.models.map((model) => model.id).sort(),
      ['manual-keep', 'remote-a'],
    );

    // 上游再次返回 remote-b：软下线的模型重新上线。
    upstreamModels = [{ id: 'remote-a' }, { id: 'remote-b' }];
    await restarted.refreshProvider(id, RUN);
    assert.deepEqual(
      restarted.listProviders().providers.find((p) => p.id === id)!.models.map((m) => m.id).sort(),
      ['manual-keep', 'remote-a', 'remote-b'],
    );
  });

  test('拉取失败：保留旧列表并写 last_error，不抛异常', async () => {
    const id = providerId('fail');
    upstreamModels = [{ id: 'kept-model' }];
    let service = await freshService();
    await service.upsertProvider(id, { name: '失败', baseUrl: serverBaseUrl() }, RUN);
    await service.refreshProvider(id, RUN);

    // 换成不可达地址，触发拉取失败。
    await service.upsertProvider(id, { baseUrl: 'http://127.0.0.1:1' }, RUN);
    const failed = await service.refreshProvider(id, RUN);
    assert.equal(failed.fetched, 0);
    assert.ok(failed.provider.lastError && failed.provider.lastError.length > 0);
    assert.deepEqual(
      failed.provider.models.map((model) => model.id),
      ['kept-model'],
      '失败时保留已配置模型',
    );

    const rows = await db.select().from(modelProviders).where(eq(modelProviders.id, id));
    assert.ok(rows[0]!.lastError && rows[0]!.lastError.length > 0);
    const modelRows = await db.select().from(modelModels).where(eq(modelModels.providerId, id));
    assert.equal(modelRows.find((row) => row.modelId === 'kept-model')!.enabled, true);

    const restarted = await freshService();
    const restored = restarted.listProviders().providers.find((provider) => provider.id === id);
    assert.ok(restored!.lastError);
    assert.deepEqual(restored!.models.map((model) => model.id), ['kept-model']);
  });

  test('用途绑定：持久化、模态 / 不存在 / 已下线模型校验、fallback 与解绑', async () => {
    const id = providerId('bind');
    upstreamModels = [{ id: 'text-model' }, { id: 'soon-offline' }];
    const service = await freshService();
    await service.upsertProvider(id, { name: '绑定', baseUrl: serverBaseUrl() }, RUN);
    await service.refreshProvider(id, RUN);

    // 手工放一个只有 image 输出的模型，用来验证模态校验。
    await upsertManualModelRow(
      db,
      {
        providerId: id,
        modelId: 'image-only',
        displayName: '仅图像',
        input: ['text'],
        output: ['image'],
        contextWindow: null,
        maxTokens: null,
      },
      new Date(),
    );

    const bound = await service.bindUsage('knowledge.embed', { providerId: id, modelId: 'text-model' }, RUN);
    assert.deepEqual(bound.resolved, { providerId: id, modelId: 'text-model' });

    const fresh = await freshService();
    const persisted = fresh.getUsages().bindings.find((binding) => binding.usageId === 'knowledge.embed');
    assert.deepEqual(persisted!.resolved, { providerId: id, modelId: 'text-model' });

    await assert.rejects(
      () => fresh.bindUsage('knowledge.embed', { providerId: id, modelId: 'does-not-exist' }, RUN),
      (error: unknown) => error instanceof BadRequestException,
    );

    await assert.rejects(
      () => fresh.bindUsage('tutor.chat', { providerId: id, modelId: 'image-only' }, RUN),
      (error: unknown) => error instanceof BadRequestException,
      '缺少文本输出模态应被拒绝',
    );

    // fallback：tutor.chat 绑定后，tutor.live（fallbackTo=tutor.chat）应解析到同一模型。
    await fresh.bindUsage('tutor.chat', { providerId: id, modelId: 'text-model' }, RUN);
    const live = fresh.getUsages().bindings.find((binding) => binding.usageId === 'tutor.live');
    assert.equal(live!.providerId, null);
    assert.equal(live!.modelId, null);
    assert.deepEqual(live!.resolved, { providerId: id, modelId: 'text-model' });

    // 软下线 soon-offline 后再绑定应被拒绝。
    upstreamModels = [{ id: 'text-model' }];
    await fresh.refreshProvider(id, RUN);
    await assert.rejects(
      () => fresh.bindUsage('knowledge.embed', { providerId: id, modelId: 'soon-offline' }, RUN),
      (error: unknown) => error instanceof BadRequestException,
      '已下线模型不得被绑定',
    );

    // 解绑。
    const unbound = await fresh.bindUsage('knowledge.embed', { providerId: null, modelId: null }, RUN);
    assert.equal(unbound.resolved, null);
    const bindingRows = await db
      .select()
      .from(modelUsageBindings)
      .where(eq(modelUsageBindings.usageId, 'knowledge.embed'));
    assert.equal(bindingRows.length, 0);
  });

  test('删除供应商：显式解绑引用它的用途并清理模型', async () => {
    const id = providerId('delete');
    upstreamModels = [{ id: 'model-x' }];
    const service = await freshService();
    await service.upsertProvider(id, { name: '待删', baseUrl: serverBaseUrl() }, RUN);
    await service.refreshProvider(id, RUN);
    await service.bindUsage('knowledge.embed', { providerId: id, modelId: 'model-x' }, RUN);

    const result = await service.deleteProvider(id, RUN);
    assert.equal(result.id, id);

    const providers = await db.select().from(modelProviders).where(eq(modelProviders.id, id));
    assert.equal(providers.length, 0);
    const models = await db.select().from(modelModels).where(eq(modelModels.providerId, id));
    assert.equal(models.length, 0);
    const bindings = await db
      .select()
      .from(modelUsageBindings)
      .where(eq(modelUsageBindings.providerId, id));
    assert.equal(bindings.length, 0);

    const restarted = await freshService();
    assert.equal(
      restarted.listProviders().providers.some((provider) => provider.id === id),
      false,
    );
    // knowledge.embed 没有 fallbackTo，删除供应商后应真正变为「无可用模型」。
    const embed = restarted.getUsages().bindings.find((binding) => binding.usageId === 'knowledge.embed');
    assert.equal(embed!.resolved, null, '供应商删除后引用用途应自动解绑');
  });

  test('审计：upsert / bind / unbind / refresh / delete 均有记录且不含明文密钥', async () => {
    const id = providerId('audit');
    const secret = 'sk-audit-secret-xyz';
    upstreamModels = [{ id: 'audit-model' }];
    const service = await freshService();

    await service.upsertProvider(id, { name: '审计', baseUrl: serverBaseUrl(), apiKey: secret }, RUN);
    await service.refreshProvider(id, RUN);
    await service.bindUsage('inspiration.recommend', { providerId: id, modelId: 'audit-model' }, RUN);
    await service.bindUsage('inspiration.recommend', { providerId: null, modelId: null }, RUN);
    await service.deleteProvider(id, RUN);

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.actorId, RUN));
    const actions = new Set(rows.map((row) => row.action));
    for (const expected of [
      'model_provider.upsert',
      'model_provider.refresh',
      'model_usage.bind',
      'model_usage.unbind',
      'model_provider.delete',
    ]) {
      assert.ok(actions.has(expected), `应有审计动作 ${expected}`);
    }

    const serialized = JSON.stringify(rows.map((row) => row.detail));
    assert.ok(!serialized.includes(secret), '审计详情不得包含明文密钥');
  });
});
