import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalTeachingJson, teachingValueDigest } from './teaching-bundle.canonical';
import { TeachingBundleCompilationError } from './teaching-bundle.types';

describe('teaching bundle canonical JSON', () => {
  it('sorts keys recursively while retaining array and instruction order', () => {
    assert.equal(canonicalTeachingJson({ z: [{ b: 2, a: 1 }], a: 'first\nsecond' }),
      '{"a":"first\\nsecond","z":[{"a":1,"b":2}]}');
    assert.equal(teachingValueDigest({ b: 2, a: 1 }), teachingValueDigest({ a: 1, b: 2 }));
    assert.notEqual(teachingValueDigest([1, 2]), teachingValueDigest([2, 1]));
  });

  it('matches a known SHA-256 fixture', () => {
    assert.equal(teachingValueDigest({}), '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it('preserves Unicode exactly rather than silently rewriting instructions', () => {
    assert.notEqual(teachingValueDigest('\u00e9'), teachingValueDigest('e\u0301'));
    assert.equal(canonicalTeachingJson('\u5149\u5b66'), '"\u5149\u5b66"');
  });

  it('supports shared acyclic values but rejects cycles', () => {
    const shared = { title: 'shared' };
    assert.equal(canonicalTeachingJson([shared, shared]), '[{"title":"shared"},{"title":"shared"}]');
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    assert.throws(() => canonicalTeachingJson(cyclic), TeachingBundleCompilationError);
  });

  const invalid: readonly [string, unknown][] = [
    ['undefined', undefined], ['function', () => 1], ['bigint', 1n],
    ['NaN', Number.NaN], ['infinity', Number.POSITIVE_INFINITY], ['date', new Date(0)],
    ['undefined property', { missing: undefined }], ['sparse array', Array(2)],
    ['symbol property', { [Symbol('hidden')]: 'value' }],
  ];
  for (const [name, value] of invalid) {
    it(`rejects non-JSON input: ${name}`, () => {
      assert.throws(() => canonicalTeachingJson(value), TeachingBundleCompilationError);
    });
  }

  it('rejects accessors without invoking them', () => {
    let invoked = false;
    const input = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked = true; return 'secret'; } });
    assert.throws(() => canonicalTeachingJson(input), TeachingBundleCompilationError);
    assert.equal(invoked, false);
  });

  it('rejects hidden properties and decorated arrays', () => {
    assert.throws(() => canonicalTeachingJson(Object.defineProperty({}, 'hidden', { value: 1 })), TeachingBundleCompilationError);
    assert.throws(() => canonicalTeachingJson(Object.assign([1], { extra: 2 })), TeachingBundleCompilationError);
  });

  it('bounds recursive depth and payload bytes', () => {
    let nested: unknown = 1;
    for (let index = 0; index < 66; index += 1) nested = [nested];
    assert.throws(() => canonicalTeachingJson(nested), TeachingBundleCompilationError);
    assert.throws(() => canonicalTeachingJson('x'.repeat(2 * 1024 * 1024)), TeachingBundleCompilationError);
  });
});
