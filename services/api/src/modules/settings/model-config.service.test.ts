import 'reflect-metadata';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ModelConfigService } from './model-config.service';

/**
 * `ModelConfigService` 是唯一决定 AI搭档 / 实时语音跑哪个模型的地方，同时
 * 是「密钥不出进程」这条安全约定的落点。这里覆盖三件事：
 *  1. 对外只给指纹，密钥绝不出现在响应里；
 *  2. 能力声明决定学生端能看到哪些输入/输出组合，缺密钥就必须收敛；
 *  3. 写入校验（否则管理员端可以塞进任意网关地址）。
 */

const ENV_KEYS = ['QITU_TEXT_MODEL_API_KEY', 'QITU_LIVE_MODEL_API_KEY'] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(clearEnv);

function fingerprintOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

describe('ModelConfigService', () => {
  it('默认两个插槽都是本地启发式引擎，且未配置密钥', () => {
    clearEnv();
    const service = new ModelConfigService();
    const [text, live] = service.listPublic();

    assert.equal(text?.provider, 'local-heuristic');
    assert.equal(text?.modelId, 'heuristic-v1');
    assert.equal(text?.configured, false);
    assert.equal(text?.keyFingerprint, null);
    assert.equal(live?.provider, 'local-heuristic');
    assert.equal(live?.modelId, 'heuristic-realtime-v1');
  });

  it('管理员写入的密钥只以指纹暴露，明文不进响应、不进序列化结果', () => {
    clearEnv();
    const service = new ModelConfigService();
    const secret = 'sk-live-super-secret-value';

    const updated = service.update('text', { provider: 'deepseek', modelId: 'deepseek-flash', apiKey: secret }, 'admin-1');

    assert.equal(updated.configured, true);
    assert.equal(updated.keyFingerprint, fingerprintOf(secret));
    assert.equal(updated.updatedBy, 'admin-1');
    assert.equal(JSON.stringify(updated).includes(secret), false);
    assert.equal(JSON.stringify(service.listPublic()).includes(secret), false);
    assert.equal(JSON.stringify(service.getRuntime()).includes(secret), false);
  });

  it('resolveSecret 回落顺序：管理员写入优先，其次环境变量，都没有则为 null', () => {
    clearEnv();
    process.env.QITU_TEXT_MODEL_API_KEY = 'env-key';
    const service = new ModelConfigService();

    assert.equal(service.resolveSecret('text'), 'env-key');

    service.update('text', { apiKey: 'override-key' }, 'admin-1');
    assert.equal(service.resolveSecret('text'), 'override-key');

    // 空串表示清除管理员写入的密钥，回落到环境变量。
    service.update('text', { apiKey: '' }, 'admin-1');
    assert.equal(service.resolveSecret('text'), 'env-key');
    assert.equal(service.getPublic('text').configured, true);
  });

  it('没有 Live 密钥时只给学生 text_text，不给任何语音组合', () => {
    clearEnv();
    const service = new ModelConfigService();
    assert.deepEqual(service.getRuntime().availableModalities, ['text_text']);
    assert.equal(service.getRuntime().liveAvailable, false);
  });

  it('Live 模型能听能说时开放三种语音组合', () => {
    clearEnv();
    process.env.QITU_LIVE_MODEL_API_KEY = 'live-key';
    const service = new ModelConfigService();
    service.update('live', { provider: 'openai', modelId: 'gpt-realtime' }, 'admin-1');

    const runtime = service.getRuntime();
    assert.equal(runtime.liveAvailable, true);
    assert.deepEqual(runtime.availableModalities, ['text_text', 'voice_voice', 'voice_text', 'text_voice']);
  });

  it('只能听不能说时只开放 voice_text，不谎报语音输出', () => {
    clearEnv();
    process.env.QITU_LIVE_MODEL_API_KEY = 'live-key';
    const service = new ModelConfigService();
    service.update('live', { provider: 'deepseek', modelId: 'deepseek-realtime' }, 'admin-1');

    assert.deepEqual(service.getRuntime().availableModalities, ['text_text', 'voice_text']);
  });

  it('管理员手填的未知 Live 模型一律不给语音能力', () => {
    clearEnv();
    process.env.QITU_LIVE_MODEL_API_KEY = 'live-key';
    const service = new ModelConfigService();
    service.update('live', { provider: 'custom-vendor', modelId: 'unknown-model' }, 'admin-1');

    assert.deepEqual(service.getRuntime().availableModalities, ['text_text']);
  });

  it('拒绝空供应商、空模型标识、超长模型标识', () => {
    clearEnv();
    const service = new ModelConfigService();

    assert.throws(() => service.update('text', { provider: '   ' }, 'admin-1'), BadRequestException);
    assert.throws(() => service.update('text', { modelId: '' }, 'admin-1'), BadRequestException);
    assert.throws(() => service.update('text', { modelId: 'x'.repeat(121) }, 'admin-1'), BadRequestException);
  });

  it('网关地址必须是 http(s)，空串等价于清除', () => {
    clearEnv();
    const service = new ModelConfigService();

    assert.throws(() => service.update('text', { baseUrl: 'ftp://evil.example' }, 'admin-1'), BadRequestException);
    assert.equal(service.update('text', { baseUrl: 'https://gateway.example' }, 'admin-1').baseUrl, 'https://gateway.example');
    assert.equal(service.update('text', { baseUrl: '   ' }, 'admin-1').baseUrl, null);
  });
});
