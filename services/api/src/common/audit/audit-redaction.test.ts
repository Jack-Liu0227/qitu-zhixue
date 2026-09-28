import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditDetail } from './audit-entry';
import { CIRCULAR_VALUE, REDACTED_VALUE, isSensitiveKey, redactSensitive } from './audit-redaction';

/**
 * `audit-redaction` / `buildAuditDetail` 的纯函数单测。
 *
 * 目前仓库尚未接入 TS 测试运行器（`pnpm test` 仍是占位脚本），因此这里只覆盖
 * 不依赖 Nest / 数据库的纯逻辑。本地可临时编译后运行（项目 `tsconfig` 已是
 * `noEmit: false`，`tsc -p tsconfig.json` 即可产出可执行 JS）：
 *
 *   cd services/api
 *   npx tsc -p tsconfig.json --outDir /tmp/qitu-audit
 *   node --test /tmp/qitu-audit/common/audit/audit-redaction.test.js
 */

test('顶层 password / apiKey / token 会被脱敏，非敏感字段保留', () => {
  const input = { email: 'a@example.com', password: 'p@ss', apiKey: 'sk-123', token: 'abc' };
  const out = redactSensitive(input);
  assert.deepEqual(out, {
    email: 'a@example.com',
    password: REDACTED_VALUE,
    apiKey: REDACTED_VALUE,
    token: REDACTED_VALUE,
  });
});

test('嵌套对象里的敏感键同样被递归脱敏', () => {
  const input = {
    model: {
      provider: 'openai',
      endpoint: { baseUrl: 'https://api.openai.com', apiKey: 'sk-secret' },
      headers: { Authorization: 'Bearer zzz' },
      credentials: { username: 'u', password: 'p' },
    },
  };
  const out = redactSensitive(input) as unknown as {
    model: {
      provider: string;
      endpoint: Record<string, string>;
      headers: Record<string, string>;
      credentials: unknown;
    };
  };
  assert.equal(out.model.provider, 'openai');
  assert.equal(out.model.endpoint.baseUrl, 'https://api.openai.com');
  assert.equal(out.model.endpoint.apiKey, REDACTED_VALUE);
  assert.equal(out.model.headers.Authorization, REDACTED_VALUE);
  // 敏感容器（credentials）整棵子树被脱敏：宁多勿漏。
  assert.equal(out.model.credentials, REDACTED_VALUE);
});

test('数组元素里的敏感键也会被脱敏', () => {
  const input: { rows: Array<Record<string, string>> } = {
    rows: [
      { name: 'a', passwordHash: 'x' },
      { name: 'b', pwd: 'y' },
    ],
  };
  const out = redactSensitive(input);
  assert.equal(out.rows[0]!.name, 'a');
  assert.equal(out.rows[0]!.passwordHash, REDACTED_VALUE);
  assert.equal(out.rows[1]!.pwd, REDACTED_VALUE);
});

test('大小写不敏感、下划线/驼峰变体都能命中', () => {
  assert.equal(isSensitiveKey('api_key'), true);
  assert.equal(isSensitiveKey('API-KEY'), true);
  assert.equal(isSensitiveKey('openaiApiKey'), true);
  assert.equal(isSensitiveKey('refreshToken'), true);
  assert.equal(isSensitiveKey('privateKey'), true);
  assert.equal(isSensitiveKey('displayName'), false);
  assert.equal(isSensitiveKey('reason'), false);
});

test('脱敏是纯函数，不修改入参', () => {
  const input = { nested: { password: 'secret' }, list: [{ token: 't' }] };
  const snapshot = JSON.stringify(input);
  redactSensitive(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('循环引用不会导致栈溢出，替换为占位值', () => {
  const input: Record<string, unknown> = { name: 'loop' };
  input.self = input;
  const out = redactSensitive(input) as Record<string, unknown>;
  assert.equal(out.name, 'loop');
  assert.equal(out.self, CIRCULAR_VALUE);
});

test('同一对象被兄弟字段共享（DAG）不会被误判为循环', () => {
  const shared = { apiKey: 'sk-1' };
  const out = redactSensitive({ left: shared, right: shared }) as Record<string, unknown>;
  const left = out.left as Record<string, unknown>;
  const right = out.right as Record<string, unknown>;
  assert.equal(left.apiKey, REDACTED_VALUE);
  assert.equal(right.apiKey, REDACTED_VALUE);
});

test('buildAuditDetail 把上下文折叠进 detail 并整体脱敏', () => {
  const detail = buildAuditDetail({
    actorId: 'admin-1',
    actorRole: 'admin',
    action: 'admin.model.update',
    targetType: 'model_provider',
    targetId: 'openai',
    reason: '例行调整',
    requestId: 'req-1',
    ip: '127.0.0.1',
    detail: { before: { apiKey: 'sk-old' }, after: { apiKey: 'sk-new', model: 'gpt-4o' } },
  });
  assert.equal(detail.actorRole, 'admin');
  assert.equal(detail.reason, '例行调整');
  assert.equal(detail.requestId, 'req-1');
  assert.equal(detail.ip, '127.0.0.1');
  const after = detail.after as Record<string, unknown>;
  assert.equal(after.apiKey, REDACTED_VALUE);
  assert.equal(after.model, 'gpt-4o');
});

test('buildAuditDetail 上下文覆盖业务 detail 的同名键', () => {
  const detail = buildAuditDetail({
    action: 'x',
    targetType: 'y',
    reason: '审计层原因',
    detail: { reason: '调用方随手塞的原因', ok: true },
  });
  assert.equal(detail.reason, '审计层原因');
  assert.equal(detail.ok, true);
});

test('buildAuditDetail 在无业务 detail 时返回仅含上下文的脱敏对象', () => {
  const detail = buildAuditDetail({ action: 'x', targetType: 'y', requestId: 'req-2' });
  assert.deepEqual(detail, { requestId: 'req-2' });
});
