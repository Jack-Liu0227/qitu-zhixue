import test from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { FEEDBACK_ATTACHMENT_MAX_BYTES } from '@qitu/contracts';
import { parseAttachment } from './feedback-attachment.validation';

const input = { childId: 'child', fileName: '观察记录.txt', contentType: 'text/plain', base64: Buffer.from('改变一个变量，记录看到的条纹。').toString('base64') };
test('bounded UTF-8 uploads preserve the exact bytes and reject forged content', () => {
  assert.deepEqual(parseAttachment(input).bytes, Buffer.from('改变一个变量，记录看到的条纹。'));
  for (const body of [null, { ...input, ownerUserId: 'other' }, { ...input, fileName: '../记录.txt' },
    { ...input, fileName: '记录\r\n.txt' }, { ...input, base64: '' }, { ...input, base64: 'abc=' },
    { ...input, fileName: '记录.png', contentType: 'image/png' }, { ...input, contentType: 'text/html' },
    { ...input, base64: Buffer.from([255,254]).toString('base64') },
    { ...input, base64: Buffer.alloc(FEEDBACK_ATTACHMENT_MAX_BYTES + 1, 65).toString('base64') }]) {
    assert.throws(() => parseAttachment(body), BadRequestException);
  }
});
test('the size boundary accepts a full two MiB text without recursive regex parsing', () => {
  assert.equal(parseAttachment({ ...input, base64: Buffer.alloc(FEEDBACK_ATTACHMENT_MAX_BYTES, 65).toString('base64') }).bytes.length, FEEDBACK_ATTACHMENT_MAX_BYTES);
});
