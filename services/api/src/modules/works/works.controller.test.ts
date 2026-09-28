import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CurrentUser } from '@qitu/contracts';
import { ArtifactsController, FilesController } from './works.controller';
import type { AuthService } from '../identity-auth/auth.service';
import type { WorksService } from './works.service';

const STUDENT: CurrentUser = {
  id: 'student-1',
  email: 's@e.com',
  displayName: 'S',
  role: 'student',
};

const auth = {
  getSession: () => ({ user: STUDENT }),
} as unknown as AuthService;

/** 只覆盖「请求校验层」的桩；写路径不应被执行。 */
const works = {
  createArtifact: () => {
    throw new Error('should not reach the service');
  },
  updateArtifact: () => {
    throw new Error('should not reach the service');
  },
  presignUpload: () => {
    throw new Error('should not reach the service');
  },
} as unknown as WorksService;

async function assertHttpError(
  fn: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    assert.equal(httpError.getStatus?.(), status);
    const response = httpError.getResponse?.() as { code?: string } | undefined;
    assert.equal(response?.code, code);
    return true;
  });
}

const cookie = 'qitu_session=token';

describe('作品控制器 — 服务端字段拒绝', () => {
  it('创建时提交 status / publishedAt / visibility → 400', async () => {
    const controller = new ArtifactsController(works, auth);
    for (const field of ['status', 'publishedAt', 'visibility', 'evidence']) {
      await assertHttpError(
        () =>
          controller.create(cookie, 'idem-key-1', {
            title: 'A',
            [field]: field === 'publishedAt' ? new Date().toISOString() : 'published',
          }),
        400,
        'ARTIFACT_SERVER_OWNED_FIELD',
      );
    }
  });

  it('编辑时提交 status → 400', async () => {
    const controller = new ArtifactsController(works, auth);
    await assertHttpError(
      () => controller.update(cookie, 'idem-key-2', undefined, 'art-1', { title: 'B', status: 'published' }),
      400,
      'ARTIFACT_SERVER_OWNED_FIELD',
    );
  });

  it('缺少 Idempotency-Key → 400', async () => {
    const controller = new ArtifactsController(works, auth);
    await assertHttpError(
      () => controller.create(cookie, undefined, { title: 'A' }),
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  });

  it('上传签名同样要求幂等键', async () => {
    const files = new FilesController(works, auth);
    await assertHttpError(
      () => files.presign(cookie, '   ', { filename: 'a.png', contentType: 'image/png', sizeBytes: 10 }),
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  });
});
