import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractQueryTerms, KeywordRetrievalPort } from './knowledge.retrieval.port';
import type { RetrievalCandidate } from './knowledge.types';
import { makeChunk, makeDocument } from './knowledge.test-helpers';

const port = new KeywordRetrievalPort();

function candidate(
  id: string,
  overrides: Partial<Parameters<typeof makeDocument>[0]> = {},
): RetrievalCandidate {
  return { document: makeDocument({ id, ...overrides }), chunks: [] };
}

describe('KeywordRetrievalPort 确定性排名', () => {
  it('空查询返回空结果，不倒出整个知识库', () => {
    const hits = port.retrieve({ text: '   ', limit: 4 }, [
      candidate('doc-1', { title: 'Photosynthesis' }),
    ]);
    assert.deepEqual(hits, []);
  });

  it('无命中词的候选被排除', () => {
    const hits = port.retrieve({ text: 'photosynthesis', limit: 4 }, [
      candidate('doc-1', { title: '光合作用' }),
      candidate('doc-2', { title: 'Photosynthesis basics' }),
    ]);
    assert.deepEqual(
      hits.map((hit) => hit.document.id),
      ['doc-2'],
    );
  });

  it('标题命中权重高于摘要，摘要高于正文', () => {
    const hits = port.retrieve({ text: 'energy', limit: 4 }, [
      candidate('doc-body', { title: '无关', summary: '', content: 'energy 出现在正文' }),
      candidate('doc-summary', { title: '无关', summary: 'energy 出现在摘要', content: '' }),
      candidate('doc-title', { title: 'energy 标题', summary: '', content: '' }),
    ]);
    assert.deepEqual(
      hits.map((hit) => hit.document.id),
      ['doc-title', 'doc-summary', 'doc-body'],
    );
    assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0));
    assert.ok((hits[1]?.score ?? 0) > (hits[2]?.score ?? 0));
  });

  it('同分按 document.id 升序，保证可复现', () => {
    const options = { title: 'energy', summary: '', content: '' };
    const forward = port.retrieve({ text: 'energy', limit: 4 }, [
      candidate('doc-b', options),
      candidate('doc-a', options),
    ]);
    const backward = port.retrieve({ text: 'energy', limit: 4 }, [
      candidate('doc-a', options),
      candidate('doc-b', options),
    ]);
    assert.deepEqual(forward.map((hit) => hit.document.id), ['doc-a', 'doc-b']);
    assert.deepEqual(
      forward.map((hit) => hit.document.id),
      backward.map((hit) => hit.document.id),
    );
  });

  it('limit 截断并且命中词有序', () => {
    const hits = port.retrieve({ text: 'alpha beta', limit: 1 }, [
      candidate('doc-1', { title: 'alpha beta', summary: '', content: '' }),
      candidate('doc-2', { title: 'alpha', summary: '', content: '' }),
    ]);
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0]?.matchedTerms, ['alpha', 'beta']);
  });

  it('分块命中也参与打分', () => {
    const chunked: RetrievalCandidate = {
      document: makeDocument({ id: 'doc-chunk', title: '无关', summary: '', content: '开头' }),
      chunks: [makeChunk('doc-chunk', 0, 'vector database 说明')],
    };
    const hits = port.retrieve({ text: 'vector database', limit: 4 }, [chunked]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.document.id, 'doc-chunk');
  });

  it('中文查询通过二元组命中词组', () => {
    const hits = port.retrieve({ text: '苏格拉底提问', limit: 4 }, [
      candidate('doc-cn', { title: '苏格拉底式提问的提示阶梯', summary: '', content: '' }),
    ]);
    assert.equal(hits.length, 1);
    assert.ok(hits[0]!.matchedTerms.length > 0);
  });

  it('同一输入重复调用结果完全一致', () => {
    const candidates = [
      candidate('doc-1', { title: 'alpha', summary: 'beta', content: 'gamma' }),
      candidate('doc-2', { title: 'alpha beta', summary: '', content: '' }),
    ];
    const first = port.retrieve({ text: 'alpha beta', limit: 4 }, candidates);
    const second = port.retrieve({ text: 'alpha beta', limit: 4 }, candidates);
    assert.deepEqual(first, second);
  });
});

describe('extractQueryTerms', () => {
  it('去重并保留中文二元组', () => {
    const terms = extractQueryTerms('光合作用 光合作用');
    assert.ok(terms.includes('光合作用'));
    assert.ok(terms.includes('光合'));
    assert.equal(new Set(terms).size, terms.length);
  });
});
