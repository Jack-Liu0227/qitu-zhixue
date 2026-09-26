import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  ModelConfigPublic,
  ModelRuntimeResponse,
  ModelSlot,
  ModelSlotOption,
  UpdateModelConfigRequest,
} from '@qitu/contracts';

/**
 * 模型配置（「我的模型」+「Live 模型」）。
 *
 * 这个服务是**唯一**决定 AI 搭档与实时语音跑哪个模型的地方。管理员端写入，
 * 其他端只读。
 *
 * 密钥处理：
 *  - 明文只在 `PATCH` 请求里出现一次，落进这个进程内的 Map（或来自环境变量），
 *    然后立刻被丢弃。对外只暴露 SHA-256 前 12 位的指纹。
 *  - 日志里只打印插槽与模型标识，**不打印密钥**。
 *  - 进程重启后管理员临时写入的密钥会丢失，这是刻意的：现在没有密钥库，
 *    宁可重启后回到环境变量配置，也不把密钥写到磁盘上。
 *  - 生产环境应改用密钥管理服务，此处的实现已在接口上留好了位置。
 */

const SLOTS: ModelSlot[] = ['text', 'live'];

/** 需要密钥的供应商；`local-heuristic` 是仓库里确定性、无需密钥的引擎。 */
const OPTIONS: ModelSlotOption[] = [
  {
    provider: 'local-heuristic',
    modelId: 'heuristic-v1',
    label: '本地启发式引擎（无需密钥，确定性）',
    slot: 'text',
    requiresApiKey: false,
  },
  {
    provider: 'local-heuristic',
    modelId: 'heuristic-realtime-v1',
    label: '本地实时引擎（无需密钥，确定性）',
    slot: 'live',
    requiresApiKey: false,
  },
  { provider: 'deepseek', modelId: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', slot: 'text', requiresApiKey: true },
  { provider: 'deepseek', modelId: 'deepseek-flash', label: 'DeepSeek Flash', slot: 'text', requiresApiKey: true },
  { provider: 'deepseek', modelId: 'deepseek-realtime', label: 'DeepSeek 实时语音', slot: 'live', requiresApiKey: true },
  { provider: 'openai', modelId: 'gpt-realtime', label: 'OpenAI Realtime', slot: 'live', requiresApiKey: true },
];

const ENV_KEY: Record<ModelSlot, string> = {
  text: 'QITU_TEXT_MODEL_API_KEY',
  live: 'QITU_LIVE_MODEL_API_KEY',
};

interface SlotState {
  provider: string;
  modelId: string;
  baseUrl: string | null;
  /** 管理员通过接口写入的密钥；null 表示回落到环境变量。 */
  apiKeyOverride: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const DEFAULTS: Record<ModelSlot, Pick<SlotState, 'provider' | 'modelId'>> = {
  text: { provider: 'local-heuristic', modelId: 'heuristic-v1' },
  live: { provider: 'local-heuristic', modelId: 'heuristic-realtime-v1' },
};

const MAX_MODEL_ID = 120;
const MAX_BASE_URL = 300;

@Injectable()
export class ModelConfigService {
  private readonly logger = new Logger(ModelConfigService.name);
  private readonly state = new Map<ModelSlot, SlotState>();

  constructor() {
    for (const slot of SLOTS) {
      this.state.set(slot, {
        ...DEFAULTS[slot],
        baseUrl: null,
        apiKeyOverride: null,
        updatedAt: null,
        updatedBy: null,
      });
      // 只打印插槽与模型标识；环境变量里的密钥是否存在也不打印。
      this.logger.log(`模型插槽 ${slot} → ${DEFAULTS[slot].provider}/${DEFAULTS[slot].modelId}`);
    }
  }

  /* ------------------------------- 读 ------------------------------- */

  getOptions(): ModelSlotOption[] {
    return OPTIONS;
  }

  getPublic(slot: ModelSlot): ModelConfigPublic {
    const state = this.requireState(slot);
    const secret = this.resolveSecret(slot);
    return {
      slot,
      provider: state.provider,
      modelId: state.modelId,
      baseUrl: state.baseUrl,
      configured: secret !== null,
      keyFingerprint: secret === null ? null : fingerprint(secret),
      updatedAt: state.updatedAt,
      updatedBy: state.updatedBy,
    };
  }

  listPublic(): ModelConfigPublic[] {
    return SLOTS.map((slot) => this.getPublic(slot));
  }

  getRuntime(): ModelRuntimeResponse {
    return {
      textModelId: this.getPublic('text').modelId,
      liveModelId: this.getPublic('live').modelId,
      liveAvailable: this.getPublic('live').configured,
    };
  }

  /**
   * 解析当前生效的密钥。**只有**供应商调用方可以拿到明文；
   * 绝不能把返回值交给任何控制器。
   */
  resolveSecret(slot: ModelSlot): string | null {
    const state = this.requireState(slot);
    if (state.apiKeyOverride !== null && state.apiKeyOverride.length > 0) {
      return state.apiKeyOverride;
    }
    const fromEnv = process.env[ENV_KEY[slot]];
    return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : null;
  }

  /* ------------------------------- 写 ------------------------------- */

  update(slot: ModelSlot, input: UpdateModelConfigRequest, actorId: string): ModelConfigPublic {
    const state = this.requireState(slot);

    if (input.provider !== undefined) {
      const provider = input.provider.trim();
      if (provider.length === 0) throw new BadRequestException('供应商不能为空');
      state.provider = provider;
    }
    if (input.modelId !== undefined) {
      const modelId = input.modelId.trim();
      if (modelId.length === 0) throw new BadRequestException('模型标识不能为空');
      if (modelId.length > MAX_MODEL_ID) throw new BadRequestException('模型标识过长');
      state.modelId = modelId;
    }
    if (input.baseUrl !== undefined) {
      const baseUrl = input.baseUrl === null ? '' : input.baseUrl.trim();
      if (baseUrl.length > MAX_BASE_URL) throw new BadRequestException('网关地址过长');
      if (baseUrl.length > 0 && !/^https?:\/\//i.test(baseUrl)) {
        throw new BadRequestException('网关地址必须以 http:// 或 https:// 开头');
      }
      state.baseUrl = baseUrl.length === 0 ? null : baseUrl;
    }
    if (input.apiKey !== undefined) {
      const apiKey = input.apiKey.trim();
      // 空串 = 清除管理员写入的密钥，回落到环境变量。
      state.apiKeyOverride = apiKey.length === 0 ? null : apiKey;
    }

    state.updatedAt = new Date().toISOString();
    state.updatedBy = actorId;

    // 只记插槽与模型标识：密钥一个字都不进日志。
    this.logger.log(
      `模型配置更新 slot=${slot} provider=${state.provider} modelId=${state.modelId} configured=${this.resolveSecret(slot) !== null} by=${actorId}`,
    );

    return this.getPublic(slot);
  }

  private requireState(slot: ModelSlot): SlotState {
    const state = this.state.get(slot);
    if (state === undefined) throw new BadRequestException(`未知的模型插槽：${slot}`);
    return state;
  }
}

/** SHA-256 前 12 位十六进制。足够区分不同密钥，又无法反推。 */
function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}
