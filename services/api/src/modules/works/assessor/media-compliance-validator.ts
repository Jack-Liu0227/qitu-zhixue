import { createHash } from 'node:crypto';
import { ARTIFACT_BYTES_READ_NOT_CONFIGURED, type ArtifactBytesReader } from './artifact-bytes.reader';

/**
 * 视频 / 硬件演示「合规元数据」生产者 —— **只读元数据，不解码**。
 *
 * ============================ 隐私硬约束（绑定） ============================
 *
 * 本文件、以及任何消费本文件结论的地方，**禁止**把以下内容写进模型上下文或日志：
 * - 原始视频帧 / 抽帧结果；
 * - 缩略图字节（`thumbnail_ref` 只是引用，不作为内容读取）；
 * - 转写文本 / 语音内容。
 *
 * 这不是建议，是本生产者的存在前提。今天的结构性保障（必须保留）：
 * - `model-gateway.types.ts` 的 `ModelChatMessage.content` 是普通 string，
 *   注释明确「多模态是后续任务」，`ModelCompletionRequest` 没有媒体字段——
 *   即**视频在类型层面进不了模型**；
 * - 作品 `visibility` 默认 `class`（`DEFAULT_ARTIFACT_VISIBILITY`），客户端不能写；
 * - 团队帧载荷经 `sanitizeTeamFramePayload` 剥离 raw-text 键并截断到 120 字符。
 *
 * 因此 AI 评估方只能拿到：**合规结论 + 不透明作品引用 + 人写的说明文字**。
 *
 * ============================== 能证明什么 ==============================
 *
 * 全部结论来自**容器头部**的元数据解析（不解码、不抽帧）：
 * 容器类型（魔数）、字节数、时长与分辨率（先从头部读出，读不出就报
 * `unverifiable`，**绝不用默认值编造**）、是否附有人工说明、以及
 * `evidenceRef` 是否指向一条真实且属于该学生的 `artifact_versions` 行。
 * 「视频里的机器真的动了」由人写的说明 + 后续评测承担，不在本生产者内。
 */

export const MEDIA_VALIDATOR_VERSION = 'media-compliance-v1';

/** 只读头部这么多字节即可完成全部解析（WebM 的 Tracks/Info 靠前）。 */
export const MEDIA_HEADER_WINDOW_BYTES = 512 * 1024;

/** 与 `works.service.ts` 的预签名上限一致：512MB。 */
export const MAX_MEDIA_SIGNED_SIZE_BYTES = 512 * 1024 * 1024;

/** 允许的容器（与 `ALLOWED_PRESIGN_CONTENT_TYPES` 的 mp4 / webm 两项一致）。 */
export const ALLOWED_MEDIA_CONTAINERS = ['mp4', 'webm'] as const;
export type MediaContainer = (typeof ALLOWED_MEDIA_CONTAINERS)[number];

export type MediaKind = 'video' | 'hardware_demo';

/** 人工说明的下限：至少 30 字，且不能是纯空白。 */
export const MIN_DEMO_NOTE_LENGTH = 30;

export interface MediaComplianceVerdict {
  validatorVersion: string;
  kind: MediaKind;
  /** `compliant` = 全部必检项通过；`non_compliant` = 有项明确不合格；`unverifiable` = 缺少可判定的输入。 */
  verdict: 'compliant' | 'non_compliant' | 'unverifiable';
  container: MediaContainer | null;
  /** 存储侧登记的真实总字节数（不是窗口长度）。 */
  sizeBytes: number | null;
  /** 来自容器头部；解析不出为 null（不编造）。 */
  durationSeconds: number | null;
  resolution: { width: number; height: number } | null;
  /** 是否附有人工演示说明 + 说明长度（只记长度，不记内容）。 */
  notePresent: boolean;
  noteLength: number;
  /** 对象引用 sha256（前 16 位十六进制）：可追溯被检的是哪一份字节。 */
  headerDigest: string | null;
  /** 未通过 / 无法判定的稳定原因码。 */
  issues: readonly string[];
  /** 人可读的说明（不含任何媒体内容）。 */
  notes: readonly string[];
}

export interface MediaEvidenceInput {
  /** 学生提交时填写的人工演示说明（必填，正文不进日志）。 */
  note: string | null | undefined;
  /** 期望的演示类型（默认 video）。 */
  kind?: MediaKind;
}

export interface MediaArtifactRef {
  artifactId: string;
  artifactVersionId: string;
  objectKey: string;
  /** `artifact_versions.title`（服务端记录，非客户端新填）。 */
  versionTitle: string;
  /** 该作品的归属学生（必须与提交学生对上）。 */
  studentId: string;
}

/**
 * 解析结果端口：由**持久化层**提供「objectKey 是否指向一条真实版本行」的答案。
 *
 * 这样本生产者自己不碰数据库，同时「对象引用必须真实且属于该学生」这条
 * 仍是**服务端**判定（客户端无法自证）。
 */
export abstract class MediaArtifactResolver {
  /** 找不到 → null（调用方转 400 `MEDIA_EVIDENCE_NOT_FOUND`）。 */
  abstract resolveByObjectKey(objectKey: string): Promise<MediaArtifactRef | null>;
}

export const MEDIA_EVIDENCE_NOT_FOUND = 'MEDIA_EVIDENCE_NOT_FOUND';

export class MediaEvidenceNotFoundError extends Error {
  readonly code = MEDIA_EVIDENCE_NOT_FOUND;

  constructor(message = '证据引用不存在：objectKey 未指向任何作品版本') {
    super(message);
    this.name = 'MediaEvidenceNotFoundError';
  }
}

/* ------------------------------------------------------------------ *
 * 容器头部解析（纯函数，输入字节，输出元数据）
 * ------------------------------------------------------------------ */

const MP4_CONTAINERS: readonly string[] = ['mp4'];
const WEBM_CONTAINERS: readonly string[] = ['webm'];

/** ISO-BMFF（mp4）：按 box tree 走到 mvhd / tkhd。 */
interface BoxHeader {
  type: string;
  size: number;
  headerSize: number;
  offset: number;
}

function readBoxHeader(bytes: Uint8Array, offset: number): BoxHeader | null {
  if (offset + 8 > bytes.byteLength) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(offset);
  const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
  if (size32 === 1) {
    if (offset + 16 > bytes.byteLength) return null;
    const size64 = Number(view.getBigUint64(offset + 8));
    return { type, size: size64, headerSize: 16, offset };
  }
  if (size32 === 0) return { type, size: bytes.byteLength - offset, headerSize: 8, offset };
  return { type, size: size32, headerSize: 8, offset };
}

function findBox(bytes: Uint8Array, parentStart: number, parentEnd: number, target: string, depth = 0): BoxHeader | null {
  if (depth > 4) return null;
  let cursor = parentStart;
  let guard = 0;
  while (cursor + 8 <= parentEnd && guard < 512) {
    guard += 1;
    const header = readBoxHeader(bytes, cursor);
    if (header === null || header.size < header.headerSize) return null;
    const bodyStart = cursor + header.headerSize;
    const bodyEnd = Math.min(cursor + header.size, parentEnd);
    if (header.type === target) return header;
    if (['moov', 'trak', 'mdia'].includes(header.type)) {
      const nested = findBox(bytes, bodyStart, bodyEnd, target, depth + 1);
      if (nested !== null) return nested;
    }
    cursor += header.size;
  }
  return null;
}

function parseMp4(bytes: Uint8Array): { container: MediaContainer | null; durationSeconds: number | null; resolution: { width: number; height: number } | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ftyp = findBox(bytes, 0, bytes.byteLength, 'ftyp');
  let container: MediaContainer | null = null;
  if (ftyp !== null) {
    const brandBase = ftyp.offset + ftyp.headerSize;
    if (brandBase + 4 <= bytes.byteLength) {
      const brand = String.fromCharCode(bytes[brandBase]!, bytes[brandBase + 1]!, bytes[brandBase + 2]!, bytes[brandBase + 3]!);
      container = brand.includes('qt') ? null : 'mp4';
    }
  }
  const mvhd = findBox(bytes, 0, bytes.byteLength, 'mvhd');
  let durationSeconds: number | null = null;
  if (mvhd !== null) {
    const body = mvhd.offset + mvhd.headerSize;
    const version = bytes[body];
    if (version === 1 && body + 32 <= bytes.byteLength) {
      const timescale = view.getUint32(body + 20);
      const duration = Number(view.getBigUint64(body + 24));
      if (timescale > 0 && Number.isFinite(duration)) durationSeconds = duration / timescale;
    } else if (version === 0 && body + 20 <= bytes.byteLength) {
      const timescale = view.getUint32(body + 12);
      const duration = view.getUint32(body + 16);
      if (timescale > 0) durationSeconds = duration / timescale;
    }
  }
  // 分辨率：第一层 trak 的 tkhd（video track）宽高为 16.16 定点。
  const tkhd = findBox(bytes, 0, bytes.byteLength, 'tkhd');
  let resolution: { width: number; height: number } | null = null;
  if (tkhd !== null) {
    const body = tkhd.offset + tkhd.headerSize;
    const version = bytes[body];
    // v0: 84 字节后接 width/height；v1: 96 字节后接。
    const tail = version === 1 ? 96 : 84;
    if (body + tail + 8 <= bytes.byteLength) {
      const width = view.getUint32(body + tail) / 65536;
      const height = view.getUint32(body + tail + 4) / 65536;
      if (width > 0 && height > 0) resolution = { width: Math.round(width), height: Math.round(height) };
    }
  }
  return { container, durationSeconds, resolution };
}

/* ------------------------ WebM / Matroska（EBML） ------------------------ */

function readVint(bytes: Uint8Array, offset: number): { value: number; length: number } | null {
  if (offset >= bytes.byteLength) return null;
  const first = bytes[offset]!;
  if (first === 0) return null;
  let length = 1;
  for (let mask = 0x80; mask > 0 && (first & mask) === 0; mask >>= 1) length += 1;
  if (length > 8 || offset + length > bytes.byteLength) return null;
  let value: number;
  if (length === 8) {
    // 8 字节长度：掩码位在 JS 32 位按位运算之外，必须整体剥掉最高位。
    // （`1 << 0 === 1` 会让这里恒等，得到错误的值。）
    value = first & 0x01;
  } else {
    value = first & ((1 << (8 - length)) - 1);
  }
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index]!;
  return { value, length };
}

function readUnsignedBigEndian(bytes: Uint8Array, offset: number, length: number): number | null {
  if (length <= 0 || length > 8 || offset + length > bytes.byteLength) return null;
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + bytes[offset + index]!;
  return value;
}

/** 顶层 EBML 扫描：收集所需 id 的原始值。 */
function scanEbml(bytes: Uint8Array): Map<number, number> {
  const found = new Map<number, number>();
  const WANTED = new Map<number, { idBytes: number; unsigned: boolean }>([
    [0x4489, { idBytes: 2, unsigned: false }], // Duration（float）
    [0x2ad7b1, { idBytes: 3, unsigned: true }], // TimecodeScale
    [0xb0, { idBytes: 1, unsigned: true }], // PixelWidth
    [0xba, { idBytes: 1, unsigned: true }], // PixelHeight
  ]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 逐字节滑动扫描元素头（id + size + 定长值），而不是做递归的 EBML 树解析：
  // 容器头部窗口只有 512KB，且每个 id 只取**第一个**结构自洽的命中，
  // 因此对真实 WebM（Segment/Info/Tracks 嵌套）同样有效，且不会越界读取。
  for (let cursor = 0; cursor + 2 < bytes.byteLength; cursor += 1) {
    for (const [id, spec] of WANTED) {
      if (found.has(id)) continue;
      if (!matchesElementId(bytes, cursor, id, spec.idBytes)) continue;
      const size = readVint(bytes, cursor + spec.idBytes);
      if (size === null || size.value < 1 || size.value > 8) continue;
      const bodyStart = cursor + spec.idBytes + size.length;
      if (bodyStart + size.value > bytes.byteLength) continue;
      if (spec.unsigned) {
        const value = readUnsignedBigEndian(bytes, bodyStart, size.value);
        if (value !== null && value > 0) found.set(id, value);
      } else {
        if (size.value !== 4 && size.value !== 8) continue;
        const value = size.value === 4 ? view.getFloat32(bodyStart) : view.getFloat64(bodyStart);
        if (Number.isFinite(value) && value > 0) found.set(id, value);
      }
    }
    if (found.size === WANTED.size) break;
  }
  return found;
}

function matchesElementId(bytes: Uint8Array, offset: number, id: number, idBytes: number): boolean {
  // id 的最高位必须落在最后一个 id 字节上，否则不是这个元素（避免误命中）。
  const leading = bytes[offset + idBytes - 1]!;
  const mask = idBytes === 1 ? 0xff : idBytes === 2 ? 0x7f : 0x3f;
  if ((leading & mask) !== (id & mask)) return false;
  for (let index = 0; index < idBytes; index += 1) {
    const shift = (idBytes - 1 - index) * 8;
    if (bytes[offset + index] !== ((id >>> shift) & 0xff)) return false;
  }
  return true;
}

function parseWebm(bytes: Uint8Array): { container: MediaContainer | null; durationSeconds: number | null; resolution: { width: number; height: number } | null } {
  if (!(bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)) {
    return { container: null, durationSeconds: null, resolution: null };
  }
  const found = scanEbml(bytes);
  const scale = found.get(0x2ad7b1);
  const durationRaw = found.get(0x4489);
  const durationSeconds = durationRaw !== undefined && durationRaw > 0
    ? (scale !== undefined && scale > 0 ? (durationRaw * scale) / 1_000_000_000 : durationRaw / 1000)
    : null;
  const width = found.get(0xb0);
  const height = found.get(0xba);
  const resolution = width !== undefined && height !== undefined && width > 0 && height > 0
    ? { width, height }
    : null;
  return { container: 'webm', durationSeconds, resolution };
}

export interface MediaHeaderFacts {
  container: MediaContainer | null;
  durationSeconds: number | null;
  resolution: { width: number; height: number } | null;
}

/** 纯函数：只看头部字节，不持有字节、不产生任何副本。 */
/** 按魔数分派；WebM 走 EBML。 */
export function parseContainerHeader(bytes: Uint8Array): MediaHeaderFacts {
  if (bytes.byteLength >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return parseWebm(bytes);
  }
  return parseMp4(bytes);
}

/* ------------------------------------------------------------------ *
 * 合规判定（纯函数）
 * ------------------------------------------------------------------ */

export interface MediaComplianceInput {
  kind: MediaKind;
  note: string | null | undefined;
  /** 存储侧登记的总字节数；null = 未知。 */
  sizeBytes: number | null;
  facts: MediaHeaderFacts;
  /** 头部字节的 sha256（可追溯），null = 未读到字节。 */
  headerDigest: string | null;
  /** 是否是**读路径未配置**（不可判定，而非不合格）。 */
  bytesUnavailable?: boolean;
}

export function evaluateMediaCompliance(input: MediaComplianceInput): MediaComplianceVerdict {
  const issues: string[] = [];
  const notes: string[] = [];
  const noteText = typeof input.note === 'string' ? input.note.trim() : '';
  const notePresent = noteText.length >= MIN_DEMO_NOTE_LENGTH;

  if (input.bytesUnavailable === true) {
    return {
      validatorVersion: MEDIA_VALIDATOR_VERSION,
      kind: input.kind,
      verdict: 'unverifiable',
      container: null,
      sizeBytes: input.sizeBytes,
      durationSeconds: null,
      resolution: null,
      notePresent,
      noteLength: noteText.length,
      headerDigest: null,
      issues: ['MEDIA_BYTES_UNAVAILABLE'],
      notes: ['对象存储读路径未配置：只能确认引用与说明，无法读取容器头部。'],
    };
  }

  if (input.facts.container === null || !(ALLOWED_MEDIA_CONTAINERS as readonly string[]).includes(input.facts.container)) {
    issues.push('MEDIA_CONTAINER_NOT_ALLOWED');
  } else {
    notes.push(`容器 ${input.facts.container}`);
  }

  if (input.sizeBytes === null) {
    issues.push('MEDIA_SIZE_UNKNOWN');
  } else if (input.sizeBytes <= 0 || input.sizeBytes > MAX_MEDIA_SIGNED_SIZE_BYTES) {
    issues.push('MEDIA_SIZE_OUT_OF_RANGE');
  } else {
    notes.push(`大小 ${input.sizeBytes} 字节（上限 ${MAX_MEDIA_SIGNED_SIZE_BYTES}）`);
  }

  if (input.facts.durationSeconds === null) {
    // 解析不出 ≠ 不合格：报 unverifiable，绝不填默认时长。
    issues.push('MEDIA_DURATION_UNREADABLE');
  } else {
    notes.push(`时长 ${input.facts.durationSeconds.toFixed(2)} 秒（读自容器头部，未解码）`);
  }

  if (input.facts.resolution === null) {
    issues.push('MEDIA_RESOLUTION_UNREADABLE');
  } else {
    notes.push(`分辨率 ${input.facts.resolution.width}x${input.facts.resolution.height}（读自容器头部）`);
  }

  if (!notePresent) issues.push('MEDIA_DEMO_NOTE_REQUIRED');
  else notes.push(`人工说明 ${noteText.length} 字（内容不记录）`);

  const verdict: MediaComplianceVerdict['verdict'] = issues.length === 0 ? 'compliant' : 'non_compliant';
  return {
    validatorVersion: MEDIA_VALIDATOR_VERSION,
    kind: input.kind,
    verdict,
    container: input.facts.container,
    sizeBytes: input.sizeBytes,
    durationSeconds: input.facts.durationSeconds,
    resolution: input.facts.resolution,
    notePresent,
    noteLength: noteText.length,
    headerDigest: input.headerDigest,
    issues,
    notes,
  };
}

/**
 * 合规生产者入口：解析引用 → 读头部 → 判定。
 *
 * @param resolver 真实版本行解析（引用不存在 → 抛 `MediaEvidenceNotFoundError`，调用方转 400）
 * @param reader   注入的字节读端口（只读头部窗口）
 * @param expectedStudentId 提交学生（引用归属校验，防「拿别人的作品当证据」）
 */
export async function assessMediaCompliance(deps: {
  resolver: MediaArtifactResolver;
  reader: ArtifactBytesReader;
  expectedStudentId: string;
}, objectKey: string, input: MediaEvidenceInput): Promise<{ ref: MediaArtifactRef; verdict: MediaComplianceVerdict }> {
  const ref = await deps.resolver.resolveByObjectKey(objectKey);
  if (ref === null) throw new MediaEvidenceNotFoundError();
  if (ref.studentId !== deps.expectedStudentId) {
    throw new MediaEvidenceNotFoundError('证据引用不属于该学生');
  }

  const kind: MediaKind = input.kind ?? 'video';
  let verdict: MediaComplianceVerdict;
  try {
    const window = await deps.reader.readRange(objectKey, { maxBytes: MEDIA_HEADER_WINDOW_BYTES });
    if (window === null) {
      verdict = evaluateMediaCompliance({
        kind,
        note: input.note,
        sizeBytes: null,
        facts: { container: null, durationSeconds: null, resolution: null },
        headerDigest: null,
        bytesUnavailable: true,
      });
    } else {
      const facts = parseContainerHeader(window.bytes);
      verdict = evaluateMediaCompliance({
        kind,
        note: input.note,
        sizeBytes: window.totalSizeBytes,
        facts,
        headerDigest: createHash('sha256').update(window.bytes).digest('hex'),
      });
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    // 只把「读路径未配置 / 读不到」当成不可判定；其它错误照常冒泡。
    if (code !== ARTIFACT_BYTES_READ_NOT_CONFIGURED) throw error;
    verdict = evaluateMediaCompliance({
      kind,
      note: input.note,
      sizeBytes: null,
      facts: { container: null, durationSeconds: null, resolution: null },
      headerDigest: null,
      bytesUnavailable: true,
    });
  }
  return { ref, verdict };
}

/**
 * 交给 AI 评估方的**全部**内容：合规结论 + 不透明引用 + 人工说明。
 *
 * 这个函数是隐私边界的最后一个漏斗：
 * - 只放三个字段（合规 verdict / artifact ref / note）；
 * - 刻意**不**接收字节、不接收缩略图、不接收转写。
 * 若将来有人想往这里加 `frames` / `thumbnailUrl` / `transcript`，
 * 那就是一次需要隐私评审的契约变更，不是顺手加字段。
 */
export function toMediaAssessorFacts(input: {
  ref: MediaArtifactRef;
  verdict: MediaComplianceVerdict;
  note: string | null | undefined;
}): {
  artifactRef: string;
  compliance: MediaComplianceVerdict;
  note: string;
} {
  return {
    artifactRef: `artifact_version:${input.ref.artifactVersionId}`,
    compliance: input.verdict,
    note: typeof input.note === 'string' ? input.note.trim() : '',
  };
}
