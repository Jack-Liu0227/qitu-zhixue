import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addCommerceMonths,
  commerceCycle,
  freeCommerceCycle,
  refundableFen,
} from './commerce.rules';
test('membership calendar months clamp month end without losing the original renewal anchor', () => {
  const jan = new Date('2028-01-31T15:59:00+08:00');
  assert.equal(addCommerceMonths(jan, 1).toISOString(), '2028-02-29T07:59:00.000Z');
  assert.equal(addCommerceMonths(jan, 2).toISOString(), '2028-03-31T07:59:00.000Z');
  const cycle = commerceCycle(
    jan,
    addCommerceMonths(jan, 12),
    true,
    new Date('2028-03-02T00:00:00+08:00'),
  );
  assert.equal(cycle.from.toISOString(), '2028-02-29T07:59:00.000Z');
  assert.equal(cycle.until.toISOString(), '2028-03-31T07:59:00.000Z');
});
test('free quota resets at Shanghai midnight and partial refunds use paid fen', () => {
  assert.equal(
    freeCommerceCycle(new Date('2026-10-28T16:01:00Z')).from.toISOString(),
    '2026-10-28T16:00:00.000Z',
  );
  const start = new Date('2026-10-01T00:00:00Z'),
    end = new Date('2026-10-31T00:00:00Z');
  assert.equal(refundableFen(38910, start, end, new Date('2026-10-16T00:00:00Z')), 19455);
  assert.equal(refundableFen(38910, start, end, new Date('2026-09-30')), 38910);
  assert.equal(refundableFen(38910, start, end, end), 0);
});
