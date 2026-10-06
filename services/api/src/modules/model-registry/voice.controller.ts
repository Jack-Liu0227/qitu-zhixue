import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type {
  VoiceAudioInput,
  VoiceCodec,
  VoiceModelSelection,
  VoiceSynthesisRequest,
  VoiceTranscriptionRequest,
} from '@qitu/contracts';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../identity-auth/auth.service';
import { QwenVoiceGatewayService } from './qwen-voice-gateway.service';

const SESSION_COOKIE = 'qitu_session';
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_AUDIO_BASE64_LENGTH = 16 * 1024 * 1024;

@Controller('voice')
export class VoiceController {
  constructor(
    private readonly authService: AuthService,
    private readonly voice: QwenVoiceGatewayService,
  ) {}

  @Get('capabilities')
  async capabilities(@Headers('cookie') cookieHeader: string | undefined) {
    this.requireStudent(cookieHeader);
    return { data: await this.voice.capabilities() };
  }

  @Post('transcriptions')
  async transcribe(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() body: unknown,
  ) {
    this.requireStudent(cookieHeader);
    const request = parseTranscription(body, idempotencyHeader);
    try {
      return { data: await this.voice.transcribe(request) };
    } catch (error) {
      throw mapVoiceError(error);
    }
  }

  @Post('synthesis')
  async synthesize(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() body: unknown,
  ) {
    this.requireStudent(cookieHeader);
    const request = parseSynthesis(body, idempotencyHeader);
    try {
      const events = [];
      for await (const event of await this.voice.synthesize(request)) events.push(event);
      return { data: { requestId: request.requestId, model: request.model, events } };
    } catch (error) {
      throw mapVoiceError(error);
    }
  }

  private requireStudent(cookieHeader: string | undefined): void {
    const token = readCookie(cookieHeader, SESSION_COOKIE);
    if (token === undefined) throw new UnauthorizedException('请先登录');
    const session = this.authService.getSession(token);
    if (session.user.role !== 'student') throw new ForbiddenException('语音导师仅向学生开放');
  }
}

function parseTranscription(body: unknown, idempotencyHeader: string | undefined): VoiceTranscriptionRequest {
  const value = asRecord(body);
  const idempotencyKey = stringValue(value?.idempotencyKey) ?? stringValue(idempotencyHeader);
  if (!idempotencyKey) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少 Idempotency-Key' });
  const model = parseModel(value?.model);
  const audio = parseAudio(value?.audio);
  return {
    requestId: stringValue(value?.requestId) ?? randomUUID(),
    idempotencyKey,
    model,
    audio,
    language: nullableString(value?.language),
  };
}

function parseSynthesis(body: unknown, idempotencyHeader: string | undefined): VoiceSynthesisRequest {
  const value = asRecord(body);
  const idempotencyKey = stringValue(value?.idempotencyKey) ?? stringValue(idempotencyHeader);
  if (!idempotencyKey) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少 Idempotency-Key' });
  const text = stringValue(value?.text);
  if (!text || text.length > 100_000) throw new BadRequestException({ code: 'VOICE_TEXT_INVALID', message: '语音文本无效' });
  const format = stringValue(value?.format);
  if (!format || !/^[a-z0-9_+-]{1,32}$/iu.test(format)) {
    throw new BadRequestException({ code: 'VOICE_FORMAT_INVALID', message: '语音格式无效' });
  }
  return {
    requestId: stringValue(value?.requestId) ?? randomUUID(),
    idempotencyKey,
    model: parseModel(value?.model),
    text,
    language: nullableString(value?.language),
    voice: nullableString(value?.voice),
    format: format as VoiceCodec,
  };
}

function parseModel(value: unknown): VoiceModelSelection {
  const record = asRecord(value);
  const providerId = stringValue(record?.providerId);
  const modelId = stringValue(record?.modelId);
  if (!providerId || !modelId || providerId.length > 100 || modelId.length > 200) {
    throw new BadRequestException({ code: 'VOICE_MODEL_REQUIRED', message: '语音模型无效' });
  }
  return { providerId, modelId };
}

function parseAudio(value: unknown): VoiceAudioInput {
  const record = asRecord(value);
  const codec = stringValue(record?.codec);
  const mimeType = stringValue(record?.mimeType);
  const dataBase64 = stringValue(record?.dataBase64);
  if (!codec || !mimeType || !dataBase64 || dataBase64.length > MAX_AUDIO_BASE64_LENGTH || !BASE64_RE.test(dataBase64)) {
    throw new BadRequestException({ code: 'VOICE_AUDIO_INVALID', message: '语音数据无效' });
  }
  return {
    codec: codec as VoiceCodec,
    mimeType,
    sampleRateHz: nullableNumber(record?.sampleRateHz),
    channels: nullableNumber(record?.channels),
    durationMs: nullableNumber(record?.durationMs),
    dataBase64,
  };
}

function mapVoiceError(error: unknown): Error {
  const code = error instanceof Error ? error.message : '';
  if (code === 'VOICE_MODEL_UNAVAILABLE' || code === 'VOICE_OPERATION_UNAVAILABLE') {
    return new BadRequestException({ code, message: '当前语音模型不可用' });
  }
  if (code === 'VOICE_CREDENTIAL_MISSING' || code === 'VOICE_CREDENTIAL_REJECTED') {
    return new ServiceUnavailableException({ code, message: '语音服务凭证不可用' });
  }
  return new ServiceUnavailableException({ code: 'VOICE_SERVICE_UNAVAILABLE', message: '语音服务暂时不可用' });
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
