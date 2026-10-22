export type ComposerMode = 'text' | 'voice';
export type VoiceStatus = 'idle' | 'starting' | 'recording' | 'transcribing' | 'error';
export type VoiceSelection = { providerId: string; modelId: string };
export type VoiceCapability = VoiceSelection & { operations?: string[] };

export interface QuickPromptItem {
  id: string;
  icon: string;
  label: string;
  prompt: string;
}

export const QUICK_PROMPTS: readonly QuickPromptItem[] = [
  {
    id: 'explore-experiment',
    icon: '🔬',
    label: '动态演示课件',
    prompt: '我想通过动态图示课件，观察干涉和衍射条纹的几何光路与明暗变化规律。',
  },
  {
    id: 'first-step',
    icon: '💡',
    label: '理清第一步思路',
    prompt: '我对第一步该从哪里入手还有点不确定，可以先给我一个思考方向吗？',
  },
  {
    id: 'verify-hypothesis',
    icon: '🔍',
    label: '验证我的假设',
    prompt: '我想先说说我的初步猜想，请帮我看看需要补充哪些证据：',
  },
  {
    id: 'break-down',
    icon: '🧩',
    label: '拆解核心问题',
    prompt: '这个问题可以拆成哪几个关键小步来逐个分析？',
  },
  {
    id: 'real-world-example',
    icon: '📐',
    label: '结合原理举例',
    prompt: '能不能结合刚才的原理，引导我举一个生活中的实际例子？',
  },
];

export function getRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

export function createIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface PcmAudioPayload {
  codec: 'pcm_s16le';
  mimeType: 'audio/pcm';
  sampleRateHz: 16000;
  channels: 1;
  dataBase64: string;
}

/** Qwen Realtime accepts raw 16 kHz mono PCM, while MediaRecorder emits WebM/Opus. */
export async function blobToPcm16(blob: Blob): Promise<PcmAudioPayload> {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('VOICE_AUDIO_CONVERSION_UNSUPPORTED');
  const context = new AudioContextConstructor();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const frameCount = Math.max(1, Math.ceil(decoded.duration * 16_000));
    const offline = new OfflineAudioContext(1, frameCount, 16_000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const pcm = new Int16Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
      pcm[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }
    const bytes = new Uint8Array(pcm.buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return {
      codec: 'pcm_s16le',
      mimeType: 'audio/pcm',
      sampleRateHz: 16_000,
      channels: 1,
      dataBase64: btoa(binary),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}
