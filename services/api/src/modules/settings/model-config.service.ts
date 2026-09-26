import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  ModelConfigPublic,
  ModelRuntimeResponse,
  ModelSlot,
  ModelSlotOption,
  TutorModalityMode,
  UpdateModelConfigRequest,
} from '@qitu/contracts';

/**
 * 模型配置（「我的模型」+「Live 模型」）。
 *
 * 这个服务是**唯一**决定 AI搭档与实时语音跑哪个模型的地方。管理员端写入，
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

/**
 * 内置模型目录。
 *
 * `supportsInput` / `supportsOutput` 是**能力声明**，不是宣传语：
 *  - 它们直接决定学生端能勾选哪几种输入／输出组合（见 `getRuntime`），
 *    所以只能写已经真实接通的通道。
 *  - 本地启发式引擎接收语音（拿到的是已转写文本）但**不产出音频**，
 *    因此它的 `supportsOutput` 只有 `text`；这会让「语音入→语音出」
 *    在配置本地引擎时诚实地置灰，而不是假装能说。
 *  - 接入新模型时，若未实测音频输出，请不要预先勾上 `voice`。
 */
const OPTIONS: ModelSlotOption[] = [
  {
    provider: 'local-heuristic',
    modelId: 'heuristic-v1',
    label: '本地启发式引擎（无需密钥，确定性）',
    slot: 'text',
    requiresApiKey: false,
    supportsInput: ['text'],
    supportsOutput: ['text'],
  },
  {
    provider: 'local-heuristic',
    modelId: 'heuristic-realtime-v1',
    label: '本地实时引擎（无需密钥，确定性）',
    slot: 'live',
    requiresApiKey: false,
    supportsInput: ['text', 'voice'],
    supportsOutput: ['text'],
  },
  {
    provider: 'qwen',
    modelId: 'qwen-audio-3.0-realtime-plus',
    label: '通义千问 Qwen-Audio-3.0-Realtime-Plus（端到端实时语音）',
    slot: 'live',
    requiresApiKey: true,
    supportsInput: ['text', 'voice'],
    supportsOutput: ['text', 'voice'],
  },
  { provider: 'deepseek', modelId: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', slot: 'text', requiresApiKey: true, supportsInput: ['text'], supportsOutput: ['text'] },
  { provider: 'deepseek', modelId: 'deepseek-flash', label: 'DeepSeek Flash', slot: 'text', requiresApiKey: true, supportsInput: ['text'], supportsOutput: ['text'] },
  {
    provider: 'deepseek',
    modelId: 'deepseek-realtime',
    label: 'DeepSeek 实时语音',
    slot: 'live',
    requiresApiKey: true,
    supportsInput: ['text', 'voice'],
    // 未实测音频输出，不预先声明 `voice`，避免把「能听」说成「能说」。
    supportsOutput: ['text'],
  },
  {
    provider: 'openai',
    modelId: 'gpt-realtime',
    label: 'OpenAI Realtime',
    slot: 'live',
    requiresApiKey: true,
    supportsInput: ['text', 'voice'],
    supportsOutput: ['text', 'voice'],
  },
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
    const text = this.getPublic('text');
    const live = this.getPublic('live');
    return {
      textModelId: text.modelId,
      liveModelId: live.modelId,
      liveAvailable: live.configured,
      availableModalities: this.availableModalities(),
    };
  }

  /**
   * 按当前生效的 Live 模型能力推导学生可选的组合。
   *
   * 规则（与 `settings.ts` 的契约注释一致）：
   *  - `text_text` 永远可用（文本模型是必须项）。
   *  - 其余三种都要求 Live 模型**已配置密钥**且能力声明匹配；缺什么就不给什么。
   *  - 未识别的自定义模型（管理员手填 provider/modelId）一律不给语音能力：
   *    我们无法声明一个自己没实测过的能力，宁可让学生先用文字。
   */
  private availableModalities(): TutorModalityMode[] {
    const available: TutorModalityMode[] = ['text_text'];
    const live = this.getPublic('live');
    if (!live.configured) return available;

    const option = OPTIONS.find((o) => o.provider === live.provider && o.modelId === live.modelId);
    if (option === undefined) return available;

    const canHear = option.supportsInput.includes('voice');
    const canSpeak = option.supportsOutput.includes('voice');
    if (canHear && canSpeak) available.push('voice_voice');
    if (canHear) available.push('voice_text');
    if (canSpeak) available.push('text_voice');
    return available;
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
