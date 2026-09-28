import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildOutboxRow,
  decideOutboxFailure,
} from './outbox.service';
import { FEEDBACK_OUTBOX_TOPICS, OUTBOX_MAX_ATTEMPTS } from './outbox.types';

/**
 * outbox 的纯函数测试：不连库、不依赖 worker。
 *
 * 覆盖两条被明确写进语义的保证：
 * - 新事件一定是 `pending`（等待投递），不会是 `published`；
 * - 投递失败按尝试次数在 `pending`（可重试）与 `failed`（终态、可观测）之间迁移。
 */
describe('outbox 事件初始状态', () => {
  it('新事件为 pending，attempts=0，lastError=null', () => {
    const row = buildOutboxRow({
      id: 'of-1',
      topic: FEEDBACK_OUTBOX_TOPICS.submitted,
      payload: { ticketId: 'ft-1', status: 'processing' },
    });

    assert.equal(row.id, 'of-1');
    assert.equal(row.topic, 'feedback.ticket.submitted');
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0);
    assert.equal(row.lastError, null);
    assert.deepEqual(row.payload, { ticketId: 'ft-1', status: 'processing' });
  });

  it('载荷在落库前递归脱敏，敏感字段不会进入 outbox', () => {
    const row = buildOutboxRow({
      id: 'of-2',
      topic: FEEDBACK_OUTBOX_TOPICS.submitted,
      payload: { ticketId: 'ft-2', apiKey: 'sk-secret', nested: { token: 'abc' } },
    });

    assert.equal(row.payload.apiKey, '[REDACTED]');
    assert.deepEqual(row.payload.nested, { token: '[REDACTED]' });
  });
});

describe('outbox 投递失败判定', () => {
  it('未达上限时回到 pending 以便重试，并记录脱敏后的原因', () => {
    const decision = decideOutboxFailure(0, new Error('smtp timeout'));

    assert.equal(decision.status, 'pending');
    assert.equal(decision.attempts, 1);
    assert.equal(decision.lastError, 'smtp timeout');
  });

  it('达到上限后进入终态 failed，使失败可被运维观测', () => {
    const decision = decideOutboxFailure(OUTBOX_MAX_ATTEMPTS - 1, 'still failing');

    assert.equal(decision.status, 'failed');
    assert.equal(decision.attempts, OUTBOX_MAX_ATTEMPTS);
    assert.equal(decision.lastError, 'still failing');
  });

  it('失败原因中的明文凭据同样被抹除', () => {
    const decision = decideOutboxFailure(1, 'auth failed with token=abcdef');

    assert.equal(decision.lastError, 'auth failed with token=[REDACTED]');
  });
});
