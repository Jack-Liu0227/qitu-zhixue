import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { eq, inArray, like } from 'drizzle-orm';
import type { ModelDescriptor } from '@qitu/contracts';
import {
  auditLogs,
  createDb,
  idempotencyKeys,
  modelModels,
  modelProviders,
  modelUsageBindings,
  type Database,
} from '@qitu/database';
import { AuditService } from '../../common/audit';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { AuthService } from '../identity-auth/auth.service';
import { ModelRegistryController } from './model-registry.controller';
import { ModelRegistryService } from './model-registry.service';
import { upsertRemoteModels } from './model-registry.persistence';

/**
 * 管理员「手工模型 API」的真实 PostgreSQL 集成测试。
 *
 * 覆盖：
 * - 手工创建落库、协议缺省沿用供应商、模态按声明、**重启式新实例**可读回；
 * - 同供应商 `modelId` 重复（含远程重名）→ 409；
 * - 更新 `displayName` 不改变 `modelId`，且重启后仍在；
 * - 远程模型禁止手工编辑 / 删除 → 409；
 * - 被用途绑定的模型禁止停用 → 409，解绑后可停用；
 * - 删除未绑定手工模型；被绑定 / 远程模型禁止删除；
 * - 审计 `model.create` / `model.update` 与业务同事务，关联 `scope:key`；
 * - 幂等：同 key 同 payload 重放，不同 payload → `IDEMPOTENCY_CONFLICT`。
 *
 * 只有设置 `DATABASE_URL` 时才运行；连接串只从进程环境读取，不写入任何文件。
 */

const connectionString = process.env.DATABASE_URL;
const skip = connectionString ? false : 'DATABASE_URL 未设置：跳过手工模型 API 集成测试';

describe('ModelRegistryService 手工模型 API（真实 PostgreSQL）', { skip }, () => {
  let db: Database;
  let audit: AuditService;

  const RUN = `mmodel-${randomUUID()}`;
  const providerId = (name: string) => `${RUN}-${name}`;

  before(() => {
    db = createDb(connectionString!);
    audit = new AuditService(db);
  });

  after(async () => {
    const providers = await db
      .select({ id: modelProviders.id })
      .from(modelProviders)
      .where(like(modelProviders.id, `${RUN}%`));
    const idList = providers.map((row) => row.id);
    if (idList.length > 0) {
      await db.delete(modelUsageBindings).where(inArray(modelUsageBindings.providerId, idList));
      await db.delete(modelModels).where(inArray(modelModels.providerId, idList));
      await db.delete(modelProviders).where(inArray(modelProviders.id, idList));
    }
    await db.delete(auditLogs).where(eq(auditLogs.actorId, RUN));
    await db.delete(idempotencyKeys).where(like(idempotencyKeys.scope, `%${RUN}%`));

    const pool = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (typeof pool?.end === 'function') await pool.end();
  });

  async function freshService(): Promise<ModelRegistryService> {
    const service = new ModelRegistryService(db, audit);
    await service.onModuleInit();
    return service;
  }

  function remoteModel(modelId: string): ModelDescriptor {
    return {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      input: ['text'],
      output: ['text'],
      contextWindow: null,
      maxTokens: null,
      source: 'fetched',
    };
  }

  /** 轻量假 AuthService：只实现 `requireRole` 用到的 `getSession`。 */
  function fakeAuth(role: 'admin' | 'student'): AuthService {
    return {
      getSession: () => ({ user: { id: RUN, role } }),
    } as unknown as AuthService;
  }

  test('手工创建：协议缺省、模态按声明、重启可读回', async () => {
    const id = providerId('create');
    let service = await freshService();
    await service.upsertProvider(
      id,
      { name: '手工', baseUrl: 'https://manual.example.com', api: 'openai-responses' },
      RUN,
    );

    const created = await service.createManualModel(
      id,
      {
        modelId: 'manual-a',
        displayName: '手工模型 A',
        input: ['text', 'image'],
        output: ['text'],
        contextWindow: 128000,
        maxTokens: 8192,
      },
      RUN,
      `${RUN}:create`,
    );
    assert.equal(created.providerId, id);
    assert.equal(created.model.source, 'manual');
    assert.equal(created.model.api, 'openai-responses', 'api 缺省沿用供应商');
    assert.deepEqual(created.model.input, ['text', 'image']);
    assert.deepEqual(created.model.output, ['text']);
    assert.equal(created.model.contextWindow, 128000);
    assert.equal(created.enabled, true);

    // 只声明 text 时不猜 audio。
    await service.createManualModel(
      id,
      { modelId: 'manual-text', displayName: '纯文本' },
      RUN,
      `${RUN}:create-text`,
    );

    const rows = await db.select().from(modelModels).where(eq(modelModels.providerId, id));
    const row = rows.find((candidate) => candidate.modelId === 'manual-a')!;
    assert.equal(row.source, 'manual');
    assert.equal(row.enabled, true);

    // 重启式新实例从库中恢复。
    service = await freshService();
    const publicProvider = service
      .listProviders()
      .providers.find((provider) => provider.id === id)!;
    const restored = publicProvider.models.find((model) => model.id === 'manual-a')!;
    assert.equal(restored.name, '手工模型 A');
    assert.deepEqual(restored.input, ['text', 'image']);
    assert.equal(restored.source, 'manual');
    const textOnly = publicProvider.models.find((model) => model.id === 'manual-text')!;
    assert.deepEqual(textOnly.output, ['text']);
    assert.ok(!textOnly.input.includes('audio'), '绝不自动补 audio');
  });

  test('手工创建校验：重复 / 远程重名 / api 不匹配 / 未知模态', async () => {
    const id = providerId('validate');
    const service = await freshService();
    await service.upsertProvider(
      id,
      { name: '校验', baseUrl: 'https://validate.example.com', api: 'openai-completions' },
      RUN,
    );

    await service.createManualModel(
      id,
      { modelId: 'dup', displayName: '重复' },
      RUN,
      `${RUN}:v1`,
    );

    // 同供应商重复。
    await assert.rejects(
      () => service.createManualModel(id, { modelId: 'dup', displayName: '再来' }, RUN, `${RUN}:v2`),
      (error: unknown) => error instanceof ConflictException,
    );

    // 远程已存在的 modelId 不允许被手工覆盖。
    await upsertRemoteModels(db, id, [remoteModel('remote-dup')], new Date());
    await assert.rejects(
      () =>
        service.createManualModel(
          id,
          { modelId: 'remote-dup', displayName: '覆盖远程' },
          RUN,
          `${RUN}:v3`,
        ),
      (error: unknown) => error instanceof ConflictException,
    );

    // api 与供应商不一致。
    await assert.rejects(
      () =>
        service.createManualModel(
          id,
          { modelId: 'api-mismatch', displayName: '协议不符', api: 'anthropic-messages' },
          RUN,
          `${RUN}:v4`,
        ),
      (error: unknown) => error instanceof BadRequestException,
    );

    // 未知模态（不猜 audio）。
    await assert.rejects(
      () =>
        service.createManualModel(
          id,
          { modelId: 'bad-modality', displayName: '视频', input: ['video'] as never },
          RUN,
          `${RUN}:v5`,
        ),
      (error: unknown) => error instanceof BadRequestException,
    );

    // 空 displayName。
    await assert.rejects(
      () => service.createManualModel(id, { modelId: 'blank', displayName: '   ' }, RUN, `${RUN}:v6`),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  test('更新 displayName：modelId 不变且重启后仍生效；远程模型禁止编辑', async () => {
    const id = providerId('update');
    let service = await freshService();
    await service.upsertProvider(id, { name: '更新', baseUrl: 'https://update.example.com' }, RUN);
    await upsertRemoteModels(db, id, [remoteModel('remote-edit')], new Date());
    service = await freshService();

    await service.createManualModel(
      id,
      { modelId: 'manual-edit', displayName: '旧名字' },
      RUN,
      `${RUN}:u1`,
    );

    const updated = await service.updateManualModel(
      id,
      'manual-edit',
      { displayName: '新名字' },
      RUN,
      `${RUN}:u2`,
    );
    assert.equal(updated.model.id, 'manual-edit', 'modelId 不可变');
    assert.equal(updated.model.name, '新名字');
    assert.equal(updated.enabled, true);

    const restarted = await freshService();
    const restored = restarted
      .listProviders()
      .providers.find((provider) => provider.id === id)!
      .models.find((model) => model.id === 'manual-edit')!;
    assert.equal(restored.name, '新名字', 'displayName 更新应在重启后保留');
    assert.equal(restored.id, 'manual-edit');

    // 远程模型只能刷新，不能手工编辑。
    await assert.rejects(
      () =>
        service.updateManualModel(id, 'remote-edit', { displayName: '越权' }, RUN, `${RUN}:u3`),
      (error: unknown) => error instanceof ConflictException,
    );

    // 路径中的 modelId 不会被改：更新其它 id 报 404。
    await assert.rejects(
      () => service.updateManualModel(id, 'does-not-exist', { displayName: 'x' }, RUN, `${RUN}:u4`),
      (error: unknown) => error instanceof Error,
    );
  });

  test('停用：被用途绑定 → 409；解绑后可停用，重启仍为停用', async () => {
    const id = providerId('disable');
    const service = await freshService();
    await service.upsertProvider(id, { name: '停用', baseUrl: 'https://disable.example.com' }, RUN);
    await service.createManualModel(
      id,
      { modelId: 'bound-model', displayName: '被绑定', output: ['text'] },
      RUN,
      `${RUN}:d1`,
    );
    await service.bindUsage('tutor.chat', { providerId: id, modelId: 'bound-model' }, RUN);

    await assert.rejects(
      () =>
        service.updateManualModel(id, 'bound-model', { enabled: false }, RUN, `${RUN}:d2`),
      (error: unknown) => error instanceof ConflictException,
      '被绑定的模型不允许停用',
    );

    // 解绑后允许停用。
    await service.bindUsage('tutor.chat', { providerId: null, modelId: null }, RUN);
    const disabled = await service.updateManualModel(
      id,
      'bound-model',
      { enabled: false },
      RUN,
      `${RUN}:d3`,
    );
    assert.equal(disabled.enabled, false);

    const restarted = await freshService();
    const publicProvider = restarted
      .listProviders()
      .providers.find((provider) => provider.id === id)!;
    assert.equal(
      publicProvider.models.some((model) => model.id === 'bound-model'),
      false,
      '停用的手工模型重启后不对外展示',
    );

    // 重新启用后再次出现。
    const reenabled = await restarted.updateManualModel(
      id,
      'bound-model',
      { enabled: true },
      RUN,
      `${RUN}:d4`,
    );
    assert.equal(reenabled.enabled, true);
  });

  test('删除：未绑定手工模型可删；远程 / 被绑定模型禁止删除', async () => {
    const id = providerId('delete');
    const service = await freshService();
    await service.upsertProvider(id, { name: '删除', baseUrl: 'https://delete.example.com' }, RUN);
    await upsertRemoteModels(db, id, [remoteModel('remote-del')], new Date());

    await service.createManualModel(
      id,
      { modelId: 'to-delete', displayName: '待删' },
      RUN,
      `${RUN}:x1`,
    );
    await service.createManualModel(
      id,
      { modelId: 'keep-bound', displayName: '被绑定', output: ['text'] },
      RUN,
      `${RUN}:x2`,
    );
    await service.bindUsage('tutor.chat', { providerId: id, modelId: 'keep-bound' }, RUN);

    await assert.rejects(
      () => service.deleteManualModel(id, 'remote-del', RUN, `${RUN}:x3`),
      (error: unknown) => error instanceof ConflictException,
    );
    await assert.rejects(
      () => service.deleteManualModel(id, 'keep-bound', RUN, `${RUN}:x4`),
      (error: unknown) => error instanceof ConflictException,
    );

    const result = await service.deleteManualModel(id, 'to-delete', RUN, `${RUN}:x5`);
    assert.deepEqual(result, { providerId: id, modelId: 'to-delete' });
    const rows = await db.select().from(modelModels).where(eq(modelModels.providerId, id));
    assert.equal(rows.some((row) => row.modelId === 'to-delete'), false);
  });

  test('审计：model.create / model.update 关联 scope:key 且详情不含密钥', async () => {
    const id = providerId('audit');
    const service = await freshService();
    await service.upsertProvider(id, { name: '审计', baseUrl: 'https://audit-model.example.com' }, RUN);

    const createScope = `admin.model-registry.model.create:${id}`;
    await service.createManualModel(
      id,
      { modelId: 'audit-model', displayName: '审计模型' },
      RUN,
      `${createScope}:key-create`,
    );
    const updateScope = `admin.model-registry.model.update:${id}:audit-model`;
    await service.updateManualModel(
      id,
      'audit-model',
      { displayName: '审计模型改名' },
      RUN,
      `${updateScope}:key-update`,
    );

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.actorId, RUN));
    const create = rows.find(
      (row) => row.action === 'model.create' && row.targetId === 'audit-model',
    );
    const update = rows.find(
      (row) => row.action === 'model.update' && row.targetId === 'audit-model',
    );
    assert.ok(create, '应有 model.create 审计');
    assert.ok(update, '应有 model.update 审计');
    assert.equal(create!.idempotencyKey, `${createScope}:key-create`);
    assert.equal(update!.idempotencyKey, `${updateScope}:key-update`);
    assert.equal(create!.targetType, 'model');
    assert.equal(create!.targetId, 'audit-model');

    const serialized = JSON.stringify(rows.map((row) => row.detail));
    assert.ok(!serialized.includes('sk-'), '审计详情不得包含任何明文密钥');
    assert.ok(!/api[_-]?key/i.test(serialized), '审计详情不得出现 apiKey 字段');
  });

  test('幂等：同 key 同 payload 重放，不同 payload 冲突', async () => {
    const id = providerId('idem');
    const service = await freshService();
    await service.upsertProvider(id, { name: '幂等', baseUrl: 'https://idem.example.com' }, RUN);
    const idempotency = new IdempotencyService(db);

    const scope = `admin.model-registry.model.create:${id}`;
    const key = randomUUID();
    const input = { modelId: 'idem-model', displayName: '幂等模型' };
    const hash = hashIdempotentInput(scope, {}, input);

    const call = () =>
      idempotency.execute(scope, key, hash, async () => ({
        status: 201,
        body: await service.createManualModel(id, input, RUN, `${scope}:${key}`),
      }));

    const first = await call();
    assert.equal(first.replayed, false);
    assert.equal(first.status, 201);

    const replayed = await call();
    assert.equal(replayed.replayed, true, '同 key 同 payload 应重放');
    assert.deepEqual(replayed.body, first.body);

    // 只应写入一行模型（重放没有二次执行）。
    const rows = await db.select().from(modelModels).where(eq(modelModels.providerId, id));
    assert.equal(rows.filter((row) => row.modelId === 'idem-model').length, 1);

    // 同 key 不同 payload → 409 冲突。
    await assert.rejects(
      () =>
        idempotency.execute(scope, key, hashIdempotentInput(scope, {}, { modelId: 'other' }), async () => ({
          status: 201,
          body: await service.createManualModel(
            id,
            { modelId: 'other', displayName: '别的' },
            RUN,
            `${scope}:${key}`,
          ),
        })),
      (error: unknown) =>
        error instanceof IdempotencyError && error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  test('控制器：未登录 401 / 非管理员 403 / 缺幂等键 400 / 头部与请求体一致 / 重放', async () => {
    const id = providerId('controller');
    const service = await freshService();
    await service.upsertProvider(id, { name: '控制器', baseUrl: 'https://controller.example.com' }, RUN);
    const idempotency = new IdempotencyService(db);
    const admin = new ModelRegistryController(service, fakeAuth('admin'), idempotency);
    const student = new ModelRegistryController(service, fakeAuth('student'), idempotency);

    // 未登录 → 401。
    await assert.rejects(
      () =>
        admin.createManualModel(undefined, undefined, id, {
          modelId: 'c1',
          displayName: 'c1',
        } as never),
      (error: unknown) => error instanceof UnauthorizedException,
    );

    // 已登录但非管理员 → 403。
    await assert.rejects(
      () =>
        student.createManualModel('qitu_session=s', 'k', id, {
          modelId: 'c1',
          displayName: 'c1',
        } as never),
      (error: unknown) => error instanceof ForbiddenException,
    );

    // 缺少幂等键 → 400。
    await assert.rejects(
      () =>
        admin.createManualModel('qitu_session=a', undefined, id, {
          modelId: 'c1',
          displayName: 'c1',
        } as never),
      (error: unknown) => error instanceof BadRequestException,
    );

    // 头部与请求体幂等键不一致 → 400。
    await assert.rejects(
      () =>
        admin.createManualModel('qitu_session=a', 'header-key', id, {
          modelId: 'c1',
          displayName: 'c1',
          idempotencyKey: 'body-key',
        } as never),
      (error: unknown) => error instanceof BadRequestException,
    );

    const created = await admin.createManualModel('qitu_session=a', 'k-create', id, {
      modelId: 'c1',
      displayName: '控制器模型',
    } as never);
    assert.equal(created.data.providerId, id);
    assert.equal(created.data.model.id, 'c1');
    assert.equal(created.data.model.name, '控制器模型');

    // 同 key 同 payload 命中重放，不重复创建。
    const replayed = await admin.createManualModel('qitu_session=a', 'k-create', id, {
      modelId: 'c1',
      displayName: '控制器模型',
    } as never);
    assert.deepEqual(replayed.data, created.data);
    const rows = await db.select().from(modelModels).where(eq(modelModels.providerId, id));
    assert.equal(rows.filter((row) => row.modelId === 'c1').length, 1);

    // PATCH 更新；modelId 保持路径值。
    const patched = await admin.updateManualModel('qitu_session=a', 'k-update', id, 'c1', {
      displayName: '改名',
    } as never);
    assert.equal(patched.data.model.id, 'c1');
    assert.equal(patched.data.model.name, '改名');

    // DELETE 需要幂等键。
    await assert.rejects(
      () => admin.deleteManualModel('qitu_session=a', undefined, id, 'c1'),
      (error: unknown) => error instanceof BadRequestException,
    );
    const deleted = await admin.deleteManualModel('qitu_session=a', 'k-delete', id, 'c1');
    assert.deepEqual(deleted.data, { providerId: id, modelId: 'c1' });
  });
});
