import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRadarGeometry } from './radarGeometry';

const level = (value: number) => ({ value, minimum: 0, maximum: 4 });

test('unobserved dimensions have no points, segments or filled polygon', () => {
  const geometry = buildRadarGeometry([null, null, null, null, null, null]);
  assert.deepEqual(geometry.points, [null, null, null, null, null, null]);
  assert.equal(geometry.polygon, null);
  assert.equal(geometry.confirmedCount, 0);
  assert.deepEqual(geometry.segments, []);
});

test('partial assessments never connect across missing dimensions or close a filled shape', () => {
  const geometry = buildRadarGeometry([level(2), level(3), null, level(4), null, null]);
  assert.equal(geometry.confirmedCount, 3);
  assert.equal(geometry.points[2], null);
  assert.equal(geometry.polygon, null);
  assert.equal(geometry.segments.length, 1);
});

test('an actual assessed minimum is a center point, while missing evidence stays null', () => {
  const geometry = buildRadarGeometry([level(0), null]);
  assert.deepEqual(geometry.points[0], { x: 300, y: 250 });
  assert.equal(geometry.points[1], null);
  assert.equal(geometry.confirmedCount, 1);
});

test('six confirmed values produce a polygon using the declared scale', () => {
  const geometry = buildRadarGeometry(Array.from({ length: 6 }, () => ({ value: 3, minimum: 1, maximum: 5 })));
  assert.equal(geometry.confirmedCount, 6);
  assert.equal(geometry.polygon?.split(' ').length, 6);
  assert.deepEqual(geometry.points[0], { x: 300, y: 172 });
});

test('invalid values and scales are absent rather than clamped into made-up results', () => {
  const geometry = buildRadarGeometry([level(-1), level(5), level(Number.NaN),
    { value: 1, minimum: 1, maximum: 1 }, { value: 1, minimum: 2, maximum: 0 }, null]);
  assert.equal(geometry.confirmedCount, 0);
  assert.equal(geometry.polygon, null);
});
