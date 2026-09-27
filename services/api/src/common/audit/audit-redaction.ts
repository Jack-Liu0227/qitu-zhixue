/**
 * 审计 detail / 日志的**递归脱敏**工具。
 *
 * 背景与约束：
 * - 审计 detail 会落库并可能被管理员查询，**绝不能**包含 `apiKey` / `password`
 *   / `token` / `authorization` 之类的凭据。
 * - 业务调用方可能在 detail 里塞进整段配置对象或请求体，敏感字段可能出现在
 *   任意深度（顶层、嵌套对象、数组元素）。因此脱敏必须是深度优先、递归的，
 *   只处理顶层字段是不够的。
 * - 本文件是**纯函数**、无副作用、不依赖 Nest / 数据库，便于直接单测
 *   （见 `audit-redaction.test.ts`）。
 *
 * 说明：只做「键名匹配」脱敏。命中敏感键名时，**整棵子树**都会被替换为
 * `[REDACTED]`（而不是深入子树再挑敏感叶子）——宁可多抹，也不冒任何凭据
 * 漏出的风险。调用方不应把非 JSON 类型（Map/Set/函数）塞进 detail；若出现，
 * 会被当作普通对象处理。Date 会原样保留（JSONB 可序列化）。
 */

/** 命中敏感键名后被替换成的占位值。 */
export const REDACTED_VALUE = '[REDACTED]';

/** 循环引用的占位值，避免 JSON 序列化时炸栈。 */
export const CIRCULAR_VALUE = '[Circular]';

/** 超过最大深度的占位值，防御异常嵌套。 */
export const TRUNCATED_VALUE = '[Truncated]';

/**
 * 敏感键名匹配规则（大小写不敏感，子串匹配）。
 *
 * 覆盖：password / passwd / pwd / secret / token（含 accessToken、refreshToken、
 * idToken、sessionToken、csrfToken）/ apiKey（含 api_key、apikey）/ authorization /
 * cookie / credential / privateKey（含 private_key）。
 *
 * 之所以用「子串」而不是「精确等于」：真实业务的字段名有 `passwordHash`、
 * `openaiApiKey`、`X-Api-Key` 这类变体，精确匹配会漏。
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key/i;

/** 判断一个键名是否敏感（导出便于单测与复用）。 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** 递归脱敏的最大深度（超过即截断，防止恶意/异常嵌套）。 */
const MAX_DEPTH = 8;

/**
 * 递归脱敏任意 JSON 可序列化值。
 *
 * - 新建对象/数组返回，**不修改入参**（纯函数）。
 * - 循环引用替换为 `[Circular]`。
 * - 深度超过 `MAX_DEPTH` 替换为 `[Truncated]`。
 */
export function redactSensitive<T>(value: T): T {
  return redact(value, new WeakSet<object>(), 0) as T;
}

function redact(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (depth > MAX_DEPTH) {
    return TRUNCATED_VALUE;
  }
  if (seen.has(value)) {
    return CIRCULAR_VALUE;
  }

  // 用「进入时加入、退出时移除」的方式做环检测：只有真正形成环的引用才会命中，
  // 同一对象被两个兄弟字段共享（DAG）不会被误判为循环。
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redact(item, seen, depth + 1));
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED_VALUE : redact(item, seen, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}
