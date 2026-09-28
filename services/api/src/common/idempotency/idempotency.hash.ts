import { createHash } from 'node:crypto';

/**
 * 幂等请求指纹的**纯函数**实现。
 *
 * 为什么需要独立的规范化：同一个语义请求，客户端（或代理）可能以不同的键顺序
 * 序列化 JSON（`{a,b}` vs `{b,a}`）。若直接 `JSON.stringify` 求 hash，两者会被
 * 误判为「同 key 不同 payload」而报 `IDEMPOTENCY_CONFLICT`。因此这里先做
 * **稳定序列化**（对象键排序、数组保持顺序），再求 SHA-256。
 *
 * 约束：
 * - 纯函数、无副作用、不依赖 Nest / 数据库，可直接单测；
 * - 只处理 JSON 可表达的数据（string / number / boolean / null / array / object /
 *   Date）。函数、Symbol、BigInt、循环引用按下面注释的规则降级，不应作为业务载荷。
 */

/**
 * 稳定 JSON 序列化。
 *
 * - 对象键按字典序排序，保证键顺序无关；
 * - 数组保持元素顺序（顺序本身是语义的一部分）；
 * - `undefined` 作为对象属性时被忽略、作为数组元素时输出 `null`（与 `JSON.stringify` 一致）；
 * - `Date` 输出 ISO 字符串；
 * - `BigInt` 输出其十进制字符串（`JSON.stringify` 会抛错，这里显式降级）；
 * - 循环引用输出 `null`，避免炸栈（正常请求载荷不应出现）。
 */
export function stableStringify(value: unknown): string {
  return stringify(value, new WeakSet<object>());
}

function stringify(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      // NaN / Infinity 会被 JSON.stringify 变成 null；保持同一行为。
      return JSON.stringify(value);
    case 'boolean':
      return JSON.stringify(value);
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'undefined':
      return 'null';
    case 'function':
    case 'symbol':
      // 不可序列化的值一律降级为 null，不抛错（保证 hash 永远可计算）。
      return 'null';
    default:
      break;
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringify(item, seen)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  if (seen.has(record)) {
    return 'null';
  }
  seen.add(record);
  try {
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stringify(record[key], seen)}`)
      .join(',')}}`;
  } finally {
    seen.delete(record);
  }
}

/**
 * 计算请求载荷的 SHA-256 十六进制指纹。
 *
 * 契约：**同 key 同 hash 才允许重放**；同 key 不同 hash 必须返回
 * `IDEMPOTENCY_CONFLICT`。调用方应把与业务语义相关的全部字段（路径参数、
 * 请求体等）一起传入。
 */
export function hashRequest(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/**
 * 把「作用域 + 路径参数 + 请求体」组合成单一哈希。
 *
 * 用于控制器：不同路径参数（如 `/projects/:id`）应产生不同指纹，避免同一
 * `Idempotency-Key` 被复用到不同对象上时被误判为重放。
 */
export function hashIdempotentInput(
  scope: string,
  pathParams: Record<string, unknown>,
  body: unknown,
): string {
  return hashRequest({ scope, pathParams, body });
}
