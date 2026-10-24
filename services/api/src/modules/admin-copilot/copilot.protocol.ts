import { BadRequestException } from '@nestjs/common';
import {
  ADMIN_COPILOT_ACTIONS, ADMIN_COPILOT_SCOPES,
  type AdminCopilotPlan, type AdminCopilotRequest,
} from '@qitu/contracts';

export function invalid(message: string): never {
  throw new BadRequestException({ code: 'COPILOT_INPUT_INVALID', message });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('需要 JSON 对象');
  return value as Record<string, unknown>;
}
export function text(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(`${field} 无效`);
  return value.trim();
}
export function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid('包含不支持的字段');
}
export function parseRequest(body: unknown): AdminCopilotRequest {
  const b = object(body);
  exact(b, ['message', 'history', 'templateId', 'templateVersionId', 'assistantId', 'teamId',
    'modelProviderId', 'modelId', 'permission', 'scope']);
  const nullable = (key: string) => b[key] == null ? null : text(b[key], key);
  if (!['read_only', 'full_access'].includes(String(b.permission))) invalid('权限模式无效');
  if (!Array.isArray(b.history) || b.history.length > 12) invalid('历史消息最多 12 条');
  const history = b.history.map(raw => {
    const row = object(raw);
    exact(row, ['role', 'content']);
    if (row.role !== 'user' && row.role !== 'assistant') invalid('历史消息角色无效');
    return { role: row.role as 'user' | 'assistant', content: text(row.content, 'history.content', 6000) };
  });
  const templateId = nullable('templateId');
  const templateVersionId = nullable('templateVersionId');
  if (templateVersionId && !templateId) invalid('版本必须属于已选择的项目模板');
  if (b.scope !== undefined && !ADMIN_COPILOT_SCOPES.includes(b.scope as never)) invalid('配置作用域无效');
  if (b.scope === 'global' && (templateId || templateVersionId)) invalid('全局作用域不能携带所选模板');
  if (b.scope === 'selected_template' && !templateId) invalid('模板作用域需要选择模板');
  return {
    ...(b.scope === undefined ? {} : { scope: b.scope as AdminCopilotRequest['scope'] }),
    message: text(b.message, 'message', 12000), history, templateId, templateVersionId,
    assistantId: text(b.assistantId, 'assistantId'), teamId: nullable('teamId'),
    modelProviderId: text(b.modelProviderId, 'modelProviderId'),
    modelId: text(b.modelId, 'modelId'), permission: b.permission as AdminCopilotRequest['permission'],
  };
}

export function parsePlan(raw: string): AdminCopilotPlan {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); }
  catch { invalid('模型未返回有效的配置计划，请重试'); }
  const plan = object(parsed);
  exact(plan, ['reply', 'actions']);
  // A reply-only object is an answer, never permission to infer or execute writes.
  const rawActions = Object.hasOwn(plan, 'actions') ? plan.actions : [];
  if (!Array.isArray(rawActions)) invalid('配置计划的 actions 必须为数组');
  if (rawActions.length > 24) invalid('单次操作最多 24 步');
  const ids = new Set<string>();
  const actions = rawActions.map(rawAction => {
    const row = object(rawAction);
    exact(row, ['id', 'kind', 'label', 'input']);
    const id = text(row.id, 'action.id', 48);
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || ids.has(id)) invalid('操作 ID 无效或重复');
    if (!ADMIN_COPILOT_ACTIONS.includes(row.kind as never)) invalid('操作类型不受支持');
    const input = object(row.input);
    inspect(input, ids);
    ids.add(id);
    return { id, kind: row.kind as AdminCopilotPlan['actions'][number]['kind'],
      label: text(row.label, 'action.label', 200), input };
  });
  return { reply: text(plan.reply, 'reply', 12000), actions };
}

function inspect(value: unknown, earlier: Set<string>, depth = 0): void {
  if (depth > 20) invalid('配置嵌套过深');
  if (Array.isArray(value)) { value.forEach(v => inspect(v, earlier, depth + 1)); return; }
  if (!value || typeof value !== 'object') return;
  const row = object(value);
  for (const key of Object.keys(row)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid('禁止的配置字段');
    if (/^(apiKey|password|token|secret|authorization|headers|secretRef)$/i.test(key)) {
      invalid('凭据须在专用设置页配置，不能经管家计划传递');
    }
  }
  if ('$ref' in row) {
    exact(row, ['$ref']);
    const ref = text(row.$ref, '$ref');
    const [id, ...path] = ref.split('.');
    if (!earlier.has(id!) || !path.length || path.some(p => !/^[a-zA-Z0-9_-]+$/.test(p) || ['__proto__', 'prototype', 'constructor'].includes(p))) {
      invalid('引用必须指向前序操作的结果字段');
    }
    return;
  }
  Object.values(row).forEach(v => inspect(v, earlier, depth + 1));
}

export function resolveInput(value: unknown, results: Map<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map(v => resolveInput(v, results));
  if (!value || typeof value !== 'object') return value;
  const row = object(value);
  if ('$ref' in row) {
    const [id, ...path] = String(row.$ref).split('.');
    let result = results.get(id!);
    for (const key of path) {
      if (!result || typeof result !== 'object' || !Object.hasOwn(result, key)) {
        invalid(`前序操作 ${id} 未成功回读字段 ${key}`);
      }
      result = (result as Record<string, unknown>)[key];
    }
    return result;
  }
  return Object.fromEntries(Object.entries(row).map(([key, v]) => [key, resolveInput(v, results)]));
}
