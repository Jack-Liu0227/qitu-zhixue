import { BadRequestException } from '@nestjs/common';
export function requireIdempotencyKey(key: string | undefined): string {
  if (!key?.trim() || key.length > 200)
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '写操作需要 Idempotency-Key',
    });
  return key.trim();
}
