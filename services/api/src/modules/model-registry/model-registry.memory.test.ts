import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../../common/audit';
import { fingerprintModelSecret } from '../../common/secrets';
import { ModelRegistryService } from './model-registry.service';

/**
 * 内存实现（`db === null`）的回归测试。
 *
 * `demo` / `test` 无 `DATABASE_URL` 时仍要能完整跑通供应商 / 用途绑定，
 * 这是显式降级路径，不能因为引入持久化而失效。此路径的密钥明文只留在进程内。
 */

function memoryService(): ModelRegistryService {
  // 内存模式下 audit 永远不会被调用（service 检查 db 后直接跳过写入）。
  return new ModelRegistryService(null, new AuditService(null));
}

test('内存模式：预置供应商自带手工模型，密钥只留在进程内', async () => {
  const service = memoryService();
  const provider = await service.upsertProvider(
    'qwen-dashscope',
    { baseUrl: 'https://dashscope.example.com', apiKey: 'sk-memory' },
    'admin-1',
  );

  assert.equal(provider.auth.configured, true);
  assert.equal(provider.auth.keyFingerprint, fingerprintModelSecret('sk-memory'));
  assert.deepEqual(
    provider.models.map((model) => model.id).sort(),
    ['qwen-audio-3.0-realtime-plus', 'qwen-max', 'qwen-plus', 'qwen3.8-flash', 'text-embedding-v3'],
  );
  assert.ok(provider.models.every((model) => model.source === 'manual'));
});

test('内存模式：用途绑定、模态校验、fallback 与删除解绑', async () => {
  const service = memoryService();
  await service.upsertProvider('qwen-dashscope', { baseUrl: 'https://dashscope.example.com' }, 'admin-1');

  const bound = await service.bindUsage(
    'tutor.chat',
    { providerId: 'qwen-dashscope', modelId: 'qwen-plus' },
    'admin-1',
  );
  assert.deepEqual(bound.resolved, { providerId: 'qwen-dashscope', modelId: 'qwen-plus' });

  // tutor.live 未显式绑定，但 fallbackTo=tutor.chat。
  const live = service.getUsages().bindings.find((binding) => binding.usageId === 'tutor.live');
  assert.equal(live!.providerId, null);
  assert.deepEqual(live!.resolved, { providerId: 'qwen-dashscope', modelId: 'qwen-plus' });

  await assert.rejects(
    () => service.bindUsage('tutor.chat', { providerId: 'qwen-dashscope', modelId: 'nope' }, 'admin-1'),
    (error: unknown) => error instanceof BadRequestException,
  );

  await service.bindUsage(
    'knowledge.embed',
    { providerId: 'qwen-dashscope', modelId: 'text-embedding-v3' },
    'admin-1',
  );
  await service.deleteProvider('qwen-dashscope', 'admin-1');

  assert.equal(service.listProviders().providers.length, 0);
  const embed = service.getUsages().bindings.find((binding) => binding.usageId === 'knowledge.embed');
  assert.equal(embed!.resolved, null, '删除供应商应解绑引用它的用途');
  assert.equal(service.getUsages().bindings.find((b) => b.usageId === 'tutor.chat')!.resolved, null);
});

test('内存模式：未知用途与未知供应商被拒绝', async () => {
  const service = memoryService();
  await assert.rejects(
    () => service.bindUsage('no.such.usage', { providerId: null, modelId: null }, 'admin-1'),
    /未知的模型用途/,
  );
  await service.upsertProvider('qwen-dashscope', { baseUrl: 'https://dashscope.example.com' }, 'admin-1');
  await assert.rejects(
    () =>
      service.bindUsage(
        'tutor.chat',
        { providerId: 'missing-provider', modelId: 'qwen-plus' },
        'admin-1',
      ),
    /供应商不存在/,
  );
});
