/**
 * 模型配置契约（管理员端配置「我的模型 / Live 模型」）。
 *
 * 安全规则（AGENTS.md 安全章节）：
 *  - 原始 API Key **永不**出现在任何响应里，也不写入日志。对外只给
 *    `configured` 布尔值与不可逆指纹 `keyFingerprint`，让管理员能确认
 *    「换的是哪一把」，但拿不回明文。
 *  - 配置的写接口只对 `admin` 开放；读运行时信息的接口对所有已登录角色开放，
 *    且只返回模型标识，不返回任何密钥材料。
 */

/** 两个插槽：普通文本对话，与实时语音（Live）。 */
export type ModelSlot = 'text' | 'live';

export interface ModelConfigPublic {
  slot: ModelSlot;
  /** 供应商标识，例如 `local-heuristic` / `openai` / `deepseek`。 */
  provider: string;
  /** 模型标识，例如 `deepseek-v4-pro`。 */
  modelId: string;
  /** 自定义网关地址；null 表示用供应商默认地址。 */
  baseUrl: string | null;
  /** 服务端是否已持有可用密钥。前端据此决定要不要引导管理员去补配置。 */
  configured: boolean;
  /** 密钥指纹（SHA-256 前 12 位）。**不是**密钥本身，无法反推。 */
  keyFingerprint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** 管理员可选的内置模型项。 */
export interface ModelSlotOption {
  provider: string;
  modelId: string;
  label: string;
  slot: ModelSlot;
  /** 该选项是否需要 API Key（本地启发式引擎不需要）。 */
  requiresApiKey: boolean;
}

export interface AdminModelsResponse {
  slots: ModelConfigPublic[];
  options: ModelSlotOption[];
}

export interface UpdateModelConfigRequest {
  provider?: string;
  modelId?: string;
  baseUrl?: string | null;
  /** 明文密钥，只在请求体里出现一次；服务端只留指纹。传空串表示清除。 */
  apiKey?: string;
}

/** 学生端 / 其他端只需要知道「跑的是哪个模型、Live 能不能用」。 */
export interface ModelRuntimeResponse {
  textModelId: string;
  liveModelId: string;
  /** Live 模式是否真的可用（已配置 live 模型的密钥）。 */
  liveAvailable: boolean;
}
