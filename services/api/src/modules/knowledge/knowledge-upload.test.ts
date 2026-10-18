import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { UPLOAD_MAX_BYTES, validateUpload } from './knowledge-upload.service';

const body = (fileName = '物理资料.docx', content: Buffer = Buffer.from('test')) => ({
  fileName,
  base64: content.toString('base64'),
  allowMaterialize: false,
});
test('upload validation normalizes paths and keeps original bytes without project import permission', () => {
  const input = validateUpload(body('C:\\tmp\\物理资料.DOCX'));
  assert.equal(input.fileName, '物理资料.DOCX');
  assert.equal(
    input.mimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.equal(input.allowMaterialize, false);
  assert.equal(input.bytes.toString(), 'test');
  assert.match(input.originalChecksum, /^[a-f0-9]{64}$/);
});
test('upload validation rejects unsupported/legacy types and fields instead of trusting MIME or paths', () => {
  for (const file of ['test.exe', 'test.doc', 'test.xls', 'test.ppt', 'test', '.pdf.exe'])
    assert.throws(() => validateUpload(body(file)), BadRequestException);
  assert.throws(
    () => validateUpload({ ...body(), mimeType: 'application/pdf' }),
    BadRequestException,
  );
  assert.throws(() => validateUpload({ ...body(), allowMaterialize: 'yes' }), BadRequestException);
});
test('upload validation rejects noncanonical base64, empty and oversized bytes', () => {
  for (const base64 of ['', '!!!', 'dGVzdA', 'dGVzdA===', 'dGVzdA==\n', 'dGVzdB=='])
    assert.throws(() => validateUpload({ ...body(), base64 }), BadRequestException);
  assert.throws(
    () => validateUpload(body('large.txt', Buffer.alloc(UPLOAD_MAX_BYTES + 1))),
    BadRequestException,
  );
  assert.equal(UPLOAD_MAX_BYTES, 100 * 1024 * 1024);
  assert.equal(
    validateUpload(body('limit.txt', Buffer.alloc(UPLOAD_MAX_BYTES, 65))).bytes.length,
    UPLOAD_MAX_BYTES,
  );
});
