import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chunkKnowledgeContent,
  computeKnowledgeChecksum,
  nextKnowledgeVersion,
  toKnowledgeEvidence,
} from './knowledge.content';
import { MAX_CHUNK_CHARS, MAX_EVIDENCE_CONTENT_CHARS } from './knowledge.types';
import { makeDocument } from './knowledge.test-helpers';

describe('知识内容纯工具', () => {
  it('checksum 对同一内容稳定、对不同内容不同', () => {
    assert.equal(computeKnowledgeChecksum('abc'), computeKnowledgeChecksum('abc'));
    assert.notEqual(computeKnowledgeChecksum('abc'), computeKnowledgeChecksum('abd'));
  });

  it('版本自增 v1 → v2，异常输入退回 v2', () => {
    assert.equal(nextKnowledgeVersion('v1'), 'v2');
    assert.equal(nextKnowledgeVersion('v9'), 'v10');
    assert.equal(nextKnowledgeVersion('weird'), 'v2');
  });

  it('分块按段落聚合且单块有界', () => {
    const paragraph = 'a'.repeat(MAX_CHUNK_CHARS + 50);
    const chunks = chunkKnowledgeContent('doc-1', `第一段\n\n第二段\n\n${paragraph}`, new Date(0));
    assert.ok(chunks.length >= 3);
    for (const chunk of chunks) {
      assert.ok(chunk.content.length <= MAX_CHUNK_CHARS);
      assert.equal(chunk.documentId, 'doc-1');
    }
    assert.deepEqual(
      chunks.map((chunk) => chunk.ordinal),
      chunks.map((_chunk, index) => index),
    );
    // 确定性 id
    assert.equal(chunks[0]?.id, 'doc-1#0');
  });

  it('证据投影截断正文并保持 active', () => {
    const content = 'x'.repeat(MAX_EVIDENCE_CONTENT_CHARS + 200);
    const hit = {
      document: makeDocument({ content, summary: content }),
      score: 0.5,
      matchedTerms: ['x'],
    };
    const evidence = toKnowledgeEvidence(hit);
    assert.equal(evidence.document.content.length, MAX_EVIDENCE_CONTENT_CHARS + 1);
    assert.ok(evidence.document.content.endsWith('…'));
    assert.equal(evidence.document.summary.length, MAX_EVIDENCE_CONTENT_CHARS + 1);
    assert.equal(evidence.document.active, true);
    assert.equal(evidence.document.scope, 'system');
    assert.deepEqual(evidence.matchedTerms, ['x']);
  });
});
