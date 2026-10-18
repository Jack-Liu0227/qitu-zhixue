import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { KnowledgeLinkProbeService } from './knowledge-link-probe.service';
import type { KnowledgeCenterService } from './knowledge-center.service';

test('linked probe requires allowlisted realpath, ready version-N and matching server model signature', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qitu-linked-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'qitu-linked-outside-'));
  const oldRoots = process.env.QITU_KNOWLEDGE_LINK_ROOTS;
  process.env.QITU_KNOWLEDGE_LINK_ROOTS = root;
  try {
    const version = join(root, 'index', 'version-7');
    await mkdir(version, { recursive: true });
    await writeFile(join(version, 'manifest.json'), JSON.stringify({ status: 'ready', docCount: 3, embeddingSignature: 'provider:model' }));
    const service = new KnowledgeLinkProbeService({} as KnowledgeCenterService);
    const compatible = await service.probe('llamaindex', join(root, 'index'), 'provider:model');
    assert.equal(compatible.ok, true);
    assert.equal(compatible.version, 'version-7');
    assert.equal(compatible.embedding.compatible, true);
    assert.equal(compatible.realPath, join(root, 'index'));
    process.env.QITU_KNOWLEDGE_LINK_ROOTS = [join(root, 'missing'), root].join(delimiter);
    assert.equal((await service.probe('llamaindex', join(root, 'index'), 'provider:model')).ok, true);
    assert.equal((await service.probe('llamaindex', join(root, 'index'), 'provider:other')).errorCode, 'EMBEDDING_SIGNATURE_MISMATCH');
    assert.equal((await service.probe('llamaindex', outside, 'provider:model')).errorCode, 'LINKED_PATH_NOT_ALLOWED');
    await writeFile(join(version, 'manifest.json'), 'null');
    assert.equal((await service.probe('llamaindex', join(root, 'index'), 'provider:model')).errorCode, 'LINKED_INDEX_NOT_READY');
    await writeFile(join(version, 'manifest.json'), JSON.stringify({ status: 'building', docCount: 3, embeddingSignature: 'provider:model' }));
    assert.equal((await service.probe('llamaindex', join(root, 'index'), 'provider:model')).errorCode, 'LINKED_INDEX_NOT_READY');
    const outsideVersion = join(outside, 'version-8');
    await mkdir(outsideVersion);
    await writeFile(join(outsideVersion, 'manifest.json'), JSON.stringify({ status: 'ready', docCount: 3, embeddingSignature: 'provider:model' }));
    await symlink(outsideVersion, join(root, 'index', 'version-8'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await service.probe('llamaindex', join(root, 'index'), 'provider:model')).errorCode, 'LINKED_PATH_NOT_ALLOWED');
  } finally {
    if (oldRoots === undefined) delete process.env.QITU_KNOWLEDGE_LINK_ROOTS;
    else process.env.QITU_KNOWLEDGE_LINK_ROOTS = oldRoots;
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
