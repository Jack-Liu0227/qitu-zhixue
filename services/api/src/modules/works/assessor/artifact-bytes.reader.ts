/**
 * 对象存储**读**端口（注入式）。
 *
 * 为什么是注入接口而不是直接连对象存储：
 * - 真实读路径尚未配置（`object-storage.presigner.ts` 在 live 无凭据时抛 503
 *   `OBJECT_STORAGE_NOT_CONFIGURED`，内存实现返回不可解析的
 *   `https://object-storage.invalid/...`）。伪造一条读路径就等于伪造验证结论，
 *   因此本工作流**不**实现真实读，只定义端口；
 * - 生产者（文档结构校验 / 视频合规 / 代码静态检查）全部写在本接口之上，
 *   因此今天就能在进程内完整单测，将来接入真实预签名 GET 时只需新增一个实现。
 *
 * 边界（未成年人数据最小化）：
 * - 端口只返回**字节**，不返回 URL、不写日志；读取上限由调用方给出，
 *   视频只读头部窗口（不解码、不抽帧、不留缩略图）。
 * - 未配置实现的错误码是稳定的，调用方据此返回「不可用」而不是「不通过」。
 */

/** 稳定错误码：读侧未配置（live 未接对象存储）。 */
export const ARTIFACT_BYTES_READ_NOT_CONFIGURED = 'OBJECT_STORAGE_READ_NOT_CONFIGURED';

/** 一段字节窗口 + 该对象的真实总长度。 */
export interface ArtifactByteRange {
  /** 窗口内的字节（可能被服务端截断到 maxBytes）。 */
  bytes: Uint8Array;
  /** 窗口在对象内的起始偏移。 */
  offset: number;
  /** 对象的真实总字节数（来自存储元数据，不是窗口长度）。 */
  totalSizeBytes: number;
  /** 存储侧登记的内容类型（不可信输入，仍需与魔数交叉核验）。 */
  contentType: string | null;
}

export class ArtifactBytesUnavailableError extends Error {
  /**
   * 稳定错误码：**读路径未配置**。
   *
   * 刻意与「对象不存在」区分开：未配置是**不可判定**，
   * 生产者必须把它翻译成 `unverifiable`，绝不能翻译成「校验不通过」。
   */
  readonly code = ARTIFACT_BYTES_READ_NOT_CONFIGURED;

  constructor(message: string) {
    super(message);
    this.name = 'ArtifactBytesUnavailableError';
  }
}

export abstract class ArtifactBytesReader {
  /**
   * 读取某个对象的字节窗口。对象不存在或不可读 → 返回 null（不抛业务异常）。
   * @param maxBytes 读取上限（生产者用于限制读量，例如只读头部窗口）。
   */
  abstract readRange(
    objectKey: string,
    range: { offset?: number; maxBytes: number },
  ): Promise<ArtifactByteRange | null>;

  /** 全文读取（文档类：Markdown / 纯文本报告）。 */
  async read(objectKey: string, maxBytes: number): Promise<Uint8Array | null> {
    const range = await this.readRange(objectKey, { maxBytes });
    return range === null ? null : range.bytes;
  }
}

/**
 * live 默认：读路径未配置。
 *
 * 明确抛错（而不是返回空字节），因为「读不到」与「内容不合法」必须区分：
 * 前者绝不能变成一条「校验不通过」的证据。
 */
export class UnconfiguredArtifactBytesReader extends ArtifactBytesReader {
  async readRange(): Promise<ArtifactByteRange | null> {
    throw new ArtifactBytesUnavailableError(
      `${ARTIFACT_BYTES_READ_NOT_CONFIGURED}: 对象存储读路径尚未配置，无法读取作品字节`,
    );
  }
}

/**
 * 测试 / 演示实现：把字节登记在内存里。
 *
 * 仅用于单测与 demo（与 `InMemoryObjectStoragePresigner` 同性质），
 * 它不代表任何真实存储语义。
 */
export class InMemoryArtifactBytesReader extends ArtifactBytesReader {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string | null }>();

  seed(objectKey: string, bytes: Uint8Array | string, contentType: string | null = null): void {
    this.objects.set(objectKey, {
      bytes: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes,
      contentType,
    });
  }

  async readRange(
    objectKey: string,
    range: { offset?: number; maxBytes: number },
  ): Promise<ArtifactByteRange | null> {
    const object = this.objects.get(objectKey);
    if (object === undefined) return null;
    const offset = Math.max(0, Math.min(range.offset ?? 0, object.bytes.byteLength));
    return {
      bytes: object.bytes.subarray(offset, offset + Math.max(0, range.maxBytes)),
      offset,
      totalSizeBytes: object.bytes.byteLength,
      contentType: object.contentType,
    };
  }

  reset(): void {
    this.objects.clear();
  }
}
