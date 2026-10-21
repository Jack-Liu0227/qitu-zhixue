import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CurrentUser } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import { ArtifactFormatService } from './artifact-format.service';
import type { WorksService } from './works.service';

const student: CurrentUser = { id: 'synthetic-owner', role: 'student', displayName: 'Synthetic', email: '' };
function fixture() {
  let allowed = true;
  const audits: Record<string, unknown>[] = [];
  const owner = {
    getArtifact: async () => {
      if (!allowed) throw new Error('OBJECT_PERMISSION_DENIED');
      return { id: 'artifact', title: '探究记录', studentId: student.id };
    },
    listVersions: async () => {
      if (!allowed) throw new Error('OBJECT_PERMISSION_DENIED');
      return [{ id: 'version', inlineText: '模型观察\n参数,结果\n1,2\n=HYPERLINK("https://invalid"),保持文字' }];
    },
  };
  const service = new ArtifactFormatService(owner as unknown as WorksService,
    { write: async (entry: Record<string, unknown>) => { audits.push(entry); } } as unknown as AuditWriter);
  return { service, audits, revoke: () => { allowed = false; } };
}

test('fixed format owner exports all four real file formats from an authorized immutable artifact', async () => {
  const h = fixture();
  for (const format of ['docx', 'pptx', 'xlsx', 'pdf'] as const) {
    const result = await h.service.export(student, 'artifact', 'version', format);
    assert.ok(result.bytes.length > 100);
    assert.equal(result.versionId, 'version');
    assert.ok(result.filename.endsWith('.' + format));
    assert.ok(result.bytes.subarray(0, 4).toString().startsWith(format === 'pdf' ? '%PDF' : 'PK'));
  }
  assert.equal(h.audits.length, 4);
  assert.equal(JSON.stringify(h.audits).includes('HYPERLINK'), false);
  assert.ok(h.audits.every(entry => (entry.detail as Record<string, unknown>).assessmentUpdated === false));
});

test('unsupported formats, absent versions and object permission failures cannot produce a file receipt', async () => {
  const h = fixture();
  await assert.rejects(h.service.export(student, 'artifact', 'version', 'html'));
  await assert.rejects(h.service.export(student, 'artifact', 'other-version', 'pdf'));
  h.revoke();
  await assert.rejects(h.service.export(student, 'artifact', 'version', 'pdf'), /OBJECT_PERMISSION_DENIED/);
  assert.equal(h.audits.length, 0);
});
