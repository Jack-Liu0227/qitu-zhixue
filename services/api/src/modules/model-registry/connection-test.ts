import type { ConnectionTestResponse } from '@qitu/contracts';

/**
 * 连接测试的**纯辅助逻辑**：构造统一响应、脱敏错误。
 *
 * 与具体供应商协议、数据库无关，因此可以脱离 Nest / 网络单测。
 *
 * 安全边界（对应 `docs/LLM_MODEL_REGISTRY.md` §5）：
 * - 只返回**配置 / 鉴权 / 模型发现连通性**结论，**不**执行、也不暗示任何推理；
 * - 错误信息绝不包含明文密钥、上游原始响应体或带凭证的 URL；
 * - `redactConnectionError` 是纵深防御：上游 fetcher 已不带密钥，这里仍按已知
 *   密钥与常见令牌形态再兜底替换一次。
 */

/** 出现敏感值时的替换文案。 */
const REDACTED = '[已脱敏]';

/** 所有成功文案都显式声明「只验证连通性」，避免管理员误以为已跑通一次推理。 */
export const CONNECTIVITY_DISCLAIMER = '仅验证配置 / 鉴权 / 模型发现，未执行推理';

/**
 * 兜底脱敏：把错误里可能出现的密钥或令牌替换掉。
 *
 * - 先按调用方提供的**已知密钥**做精确替换（长度 < 4 视为噪声，跳过，避免把
 *   正常文本误伤成占位符）；
 * - 再按 `sk-...` 与 `Bearer ...` 这两种常见形态兜底。
 *
 * 上游原始响应体从不出现在错误里（见 `fetch-models.ts`），这里不处理。
 */
export function redactConnectionError(
  message: string,
  secrets: readonly (string | null | undefined)[],
): string {
  let out = message;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.trim().length >= 4) {
      out = out.split(secret).join(REDACTED);
    }
  }
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, REDACTED);
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, `Bearer ${REDACTED}`);
  return out;
}

export interface ConnectionTestInput {
  ok: boolean;
  /** 成功时是端到端往返毫秒；失败时按契约填 `null`。 */
  latencyMs: number | null;
  testedAt: string;
  message?: string | null;
  error?: string | null;
  usageId?: string | null;
  modelId?: string | null;
}

/** 统一构造 `ConnectionTestResponse`，保证三个入口字段形状一致。 */
export function buildConnectionTestResponse(input: ConnectionTestInput): ConnectionTestResponse {
  return {
    ok: input.ok,
    latencyMs: input.latencyMs,
    message: input.message ?? null,
    error: input.error ?? null,
    testedAt: input.testedAt,
    usageId: input.usageId ?? null,
    modelId: input.modelId ?? null,
  };
}
