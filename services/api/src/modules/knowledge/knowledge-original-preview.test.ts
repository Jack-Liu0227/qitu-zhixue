import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeLibraryService } from './knowledge-library.service';
import { KnowledgeCenterController } from './knowledge-center.controller';

function fixture() {
  let enabled = true;
  const calls: Record<string, unknown>[] = [];
  const pdf = Buffer.from('%PDF-1.7\nfixture\n%%EOF');
  const manifest: Record<string, unknown> = { body: pdf.toString('base64') };
  const service = new KnowledgeLibraryService(
    {
      base: async () => ({ engine_instance_id: 'ima', library_settings: {} }),
      query: async () => [{ external_ref: { remoteKnowledgeBaseId: 'physics' } }],
      configuration: async () => ({
        config: { knowledgeEngines: { ima: { enabled, provider: 'ima', config: {} } } },
      }),
    } as never,
    {} as never,
    {
      execute: async (_: unknown, request: Record<string, unknown>) => {
        calls.push(request);
        return {
          ok: true,
          manifest:
            request.operation === 'documents'
              ? { items: [{ id: 'doc', title: '物理教材.pdf' }] }
              : manifest,
        };
      },
    } as never,
  );
  return {
    service,
    pdf,
    calls,
    manifest,
    disable: () => {
      enabled = false;
    },
  };
}

test('remote original stays in its library/folder/cursor and returns PDF bytes, not upstream URLs', async () => {
  const f = fixture();
  const result = await f.service.originalDocument('physics', 'doc', 'chapter', 'page-2');
  assert.deepEqual(result.body, f.pdf);
  assert.equal(result.file_name, '物理教材.pdf');
  assert.equal(result.mime_type, 'application/pdf');
  assert.deepEqual(
    f.calls.map((r) => r.operation),
    ['documents', 'read_original'],
  );
  assert.equal(f.calls[0]!.folderId, 'chapter');
  assert.equal(f.calls[0]!.cursor, 'page-2');
  assert.deepEqual(f.calls[1]!.externalRef, { remoteKnowledgeBaseId: 'physics' });
});

test('unlisted documents, invalid paging, disabled engines and non-PDF payloads are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.service.originalDocument('physics', 'foreign-doc'), { status: 404 });
  assert.equal(f.calls.length, 1);
  await assert.rejects(f.service.originalDocument('physics', 'doc', '', 'x'.repeat(2049)), {
    status: 400,
  });
  f.manifest.body = Buffer.from('<html>untrusted</html>').toString('base64');
  await assert.rejects(f.service.originalDocument('physics', 'doc'), { status: 404 });
  f.disable();
  await assert.rejects(f.service.originalDocument('physics', 'doc'), { status: 404 });
});

test('remote original endpoint requires a real administrator before reading files', async () => {
  let reads = 0;
  const controller = new KnowledgeCenterController(
    {} as never,
    {} as never,
    { getSession: (token: string) => ({ user: { id: token, role: token } }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      originalDocument: async () => {
        reads++;
        return { body: Buffer.from('%PDF-'), file_name: '物理.pdf' };
      },
    } as never,
  );
  await assert.rejects(controller.remoteOriginal(undefined, 'kb', 'doc', {} as never), {
    status: 401,
  });
  await assert.rejects(
    controller.remoteOriginal('qitu_session=student', 'kb', 'doc', {} as never),
    { status: 403 },
  );
  assert.equal(reads, 0);
  const headers: Record<string, string> = {};
  await controller.remoteOriginal('qitu_session=admin', 'kb', 'doc', {
    set: (value: Record<string, string>) => Object.assign(headers, value),
    send: () => {},
  } as never);
  assert.equal(reads, 1);
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.equal(headers['Content-Type'], 'application/pdf');
});
