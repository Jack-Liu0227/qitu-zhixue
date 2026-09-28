import { ServiceUnavailableException } from '@nestjs/common';

/**
 * 对象存储签名 URL 适配器边界。
 *
 * 作品封面 / 视频 / 证据截图都进**私有**对象存储，前端只拿限时签名 URL
 * （产品文档 4.6 / §10.2）。本仓库不持有任何对象存储凭据：live 未配置时
 * 诚实返回 503，绝不返回永久地址、也绝不把凭据写进代码或响应。
 */

export type PresignPurpose = 'artifact' | 'evidence' | 'thumbnail' | 'other';

export interface PresignUploadRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
  purpose: PresignPurpose;
}

export interface PresignUploadResult {
  /** 不透明对象 key，不含签名与凭据。 */
  objectKey: string;
  /** 限时上传地址。 */
  uploadUrl: string;
  method: 'PUT';
  expiresAt: string;
}

export abstract class ObjectStoragePresigner {
  abstract presign(input: PresignUploadRequest): Promise<PresignUploadResult>;
}

/** live 默认：未注入对象存储配置时 fail closed，返回 503。 */
export class UnconfiguredObjectStoragePresigner extends ObjectStoragePresigner {
  async presign(_input: PresignUploadRequest): Promise<PresignUploadResult> {
    throw new ServiceUnavailableException({
      code: 'OBJECT_STORAGE_NOT_CONFIGURED',
      message: '对象存储尚未配置，无法生成上传地址',
    });
  }
}

/**
 * 测试 / 演示实现：返回**不含凭据**的确定性地址。
 *
 * 仅 `QITU_DATA_MODE=demo|test` 使用；live 永远不会落到这里。
 */
export class InMemoryObjectStoragePresigner extends ObjectStoragePresigner {
  async presign(input: PresignUploadRequest): Promise<PresignUploadResult> {
    const safeName = sanitizeFilename(input.filename);
    const objectKey = `${input.purpose}/${Date.now()}-${safeName}`;
    return {
      objectKey,
      uploadUrl: `https://object-storage.invalid/${objectKey}`,
      method: 'PUT',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length === 0 ? 'upload.bin' : cleaned.slice(0, 120);
}
