import { createHash } from 'node:crypto';
import { TeachingBundleCompilationError } from './teaching-bundle.types';

const MAX_DEPTH = 64;
const MAX_NODES = 100_000;
const MAX_BYTES = 2 * 1024 * 1024;

/** Preserve string bytes and array order; sort object keys without locale rules. */
export function canonicalTeachingJson(value: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  function fail(path: string): never {
    throw new TeachingBundleCompilationError('CANONICAL_VALUE_INVALID', path);
  }
  function literal(text: string, path: string): string {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_BYTES) fail(path);
    return text;
  }
  function visit(current: unknown, depth: number, path: string): string {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) fail(path);
    if (current === null) return literal('null', path);
    if (typeof current === 'string' || typeof current === 'boolean') {
      return literal(JSON.stringify(current), path);
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) fail(path);
      return literal(JSON.stringify(current), path);
    }
    if (typeof current !== 'object') return fail(path);
    if (ancestors.has(current)) fail(path);
    const prototype: unknown = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) fail(path);
    if (Object.getOwnPropertySymbols(current).length > 0) fail(path);
    ancestors.add(current);
    let result: string;
    if (Array.isArray(current)) {
      const keys = Object.keys(current);
      if (Object.getOwnPropertyNames(current).length !== current.length + 1) fail(path);
      if (keys.length !== current.length || keys.some((key, index) => key !== String(index))) fail(path);
      const items: string[] = [];
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (descriptor === undefined || !('value' in descriptor)) fail(path);
        items.push(visit(descriptor.value, depth + 1, `${path}[${index}]`));
      }
      literal('[' + ','.repeat(Math.max(0, items.length - 1)) + ']', path);
      result = `[${items.join(',')}]`;
    } else {
      const entries: string[] = [];
      for (const key of Object.getOwnPropertyNames(current).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) fail(path);
        const encodedKey = literal(JSON.stringify(key), path);
        entries.push(`${encodedKey}:${visit(descriptor.value, depth + 1, `${path}.${key}`)}`);
      }
      literal('{' + ':'.repeat(entries.length) + ','.repeat(Math.max(0, entries.length - 1)) + '}', path);
      result = `{${entries.join(',')}}`;
    }
    ancestors.delete(current);
    return result;
  }
  return visit(value, 0, '$');
}

export function teachingValueDigest(value: unknown): string {
  return createHash('sha256').update(canonicalTeachingJson(value), 'utf8').digest('hex');
}
