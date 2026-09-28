import { BadRequestException } from '@nestjs/common';
import type { ModelApi, ModelModality } from '@qitu/contracts';

/**
 * 手工模型写接口的**纯校验函数**。
 *
 * 与 `ModelRegistryService` 分开的原因：管理员写模型是高风险的配置动作，
 * 校验规则（长度、模态白名单、协议一致性、幂等键解析）必须能被集中单测，
 * 而不是散落在控制器或服务里各写一份。这里不碰数据库、不碰 Nest DI，
 * 只在非法输入时抛 `BadRequestException`。
 */

/** `modelId` 是上游标识，长度上限与可读性取一个保守值。 */
export const MODEL_ID_MAX_LENGTH = 200;
/** `displayName` 只用于展示，允许稍长但同样有界。 */
export const DISPLAY_NAME_MAX_LENGTH = 200;

export const MODEL_APIS: readonly ModelApi[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
];

export const MODEL_MODALITIES: readonly ModelModality[] = ['text', 'image', 'audio'];

function badRequest(message: string): never {
  throw new BadRequestException(message);
}

function idempotencyKeyRequired(message: string): never {
  throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message });
}

/** 必填、去空白、有长度上限的 `modelId`。 */
export function requireModelId(value: unknown): string {
  if (typeof value !== 'string') badRequest('modelId 必填且必须是字符串');
  const trimmed = value.trim();
  if (trimmed.length === 0) badRequest('modelId 不能为空');
  if (trimmed.length > MODEL_ID_MAX_LENGTH) {
    badRequest(`modelId 过长（上限 ${MODEL_ID_MAX_LENGTH} 字符）`);
  }
  return trimmed;
}

/** 必填、去空白、有长度上限的 `displayName`。 */
export function requireDisplayName(value: unknown): string {
  if (typeof value !== 'string') badRequest('displayName 必填且必须是字符串');
  const trimmed = value.trim();
  if (trimmed.length === 0) badRequest('displayName 不能为空');
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    badRequest(`displayName 过长（上限 ${DISPLAY_NAME_MAX_LENGTH} 字符）`);
  }
  return trimmed;
}

/**
 * 收敛 `api`。
 *
 * 存储 schema 把协议放在**供应商**层（`model_providers.api`），`model_models`
 * 没有协议列，所以单模型覆盖协议既无法持久化、重启后又会被供应商协议覆盖。
 * 与其假装支持，不如要求请求里的 `api` 与供应商一致（或省略）。
 */
export function normaliseApi(value: unknown, providerApi: ModelApi): ModelApi {
  if (value === undefined || value === null) return providerApi;
  if (typeof value !== 'string' || !(MODEL_APIS as readonly string[]).includes(value)) {
    badRequest(`api 必须是 ${MODEL_APIS.join(' | ')}`);
  }
  if (value !== providerApi) {
    badRequest(
      `模型协议必须与所在供应商一致（当前供应商 api=${providerApi}）；` +
        '当前存储 schema 在供应商层保存协议，不支持单模型覆盖',
    );
  }
  return providerApi;
}

/**
 * 收敛模态数组。
 *
 * - 省略 / 空数组 → `['text']`（最保守的默认）；
 * - 逐个校验，遇到未知模态直接拒绝，**不猜测** `audio`；
 * - 去重并保留请求声明的顺序。
 */
export function normaliseModalities(value: unknown, field: 'input' | 'output'): ModelModality[] {
  if (value === undefined || value === null) return ['text'];
  if (!Array.isArray(value)) badRequest(`${field} 必须是模态数组`);
  if (value.length === 0) return ['text'];
  const out: ModelModality[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !(MODEL_MODALITIES as readonly string[]).includes(item)) {
      badRequest(
        `${field} 含未知模态：${JSON.stringify(item)}；仅支持 ${MODEL_MODALITIES.join(' / ')}`,
      );
    }
    const modality = item as ModelModality;
    if (!out.includes(modality)) out.push(modality);
  }
  return out;
}

/** 正整数或 null（`null` 表示未声明，不猜测上游值）。 */
export function normaliseOptionalInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    badRequest(`${field} 必须是正整数或 null`);
  }
  return value;
}

/** 布尔值；省略时用 `fallback`。 */
export function normaliseEnabled(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') badRequest('enabled 必须是布尔值');
  return value;
}

/** 幂等键请求头名（小写，Nest 传入的是小写头名对应值）。 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * 解析幂等键：**请求头优先**，请求体 `idempotencyKey` 作为兼容。
 *
 * 规则：
 * - 两者都非空且不一致 → 400（避免「头部一个键、body 另一个键」导致重放判定歧义）；
 * - 只提供其中一个 → 使用它；
 * - 都为空 → 400 `IDEMPOTENCY_KEY_REQUIRED`，**绝不**用空键静默执行。
 */
export function resolveIdempotencyKey(header: unknown, bodyValue: unknown): string {
  const headerKey = typeof header === 'string' ? header.trim() : '';
  const bodyKey = typeof bodyValue === 'string' ? bodyValue.trim() : '';
  if (headerKey.length > 0 && bodyKey.length > 0 && headerKey !== bodyKey) {
    idempotencyKeyRequired(
      'Idempotency-Key 请求头与请求体 idempotencyKey 不一致；请保持一致或只提供其中一个',
    );
  }
  const key = headerKey.length > 0 ? headerKey : bodyKey;
  if (key.length === 0) {
    idempotencyKeyRequired(
      '缺少 Idempotency-Key：请在请求头 Idempotency-Key 或请求体 idempotencyKey 提供非空值',
    );
  }
  return key;
}
