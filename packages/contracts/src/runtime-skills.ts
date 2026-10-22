import { LEGACY_TEACHING_SKILL_HASHES } from './runtime-skill-baseline.js';

export type SkillPublicationStatus = 'quarantined' | 'reviewed' | 'published' | 'deprecated' | 'revoked';

/** Shared API/worker admission. This is deliberately a flat frontmatter contract, not YAML execution. */
export function parseRuntimeSkill(id: string, raw: string, normalizedHash: string) {
  const metadata: Record<string, string> = Object.create(null);
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let valid = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id);
  if (raw.startsWith('---') && !match) valid = false;
  for (const line of (match?.[1] ?? '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator < 1) { valid = false; continue; }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (Object.hasOwn(metadata, key)) valid = false;
    metadata[key] = value;
  }
  const legacy = metadata.status === undefined && LEGACY_TEACHING_SKILL_HASHES[id] === normalizedHash;
  const runtime: 'admin' | 'teaching' | 'dev-only' | 'unknown' = metadata.runtime === 'admin' ? 'admin' : metadata.runtime === 'dev-only' ? 'dev-only'
    : metadata.runtime === 'teaching' || (metadata.runtime === undefined && legacy) ? 'teaching' : 'unknown';
  const publicationStatus: SkillPublicationStatus = legacy ? 'published'
    : ['published', 'reviewed', 'deprecated', 'revoked'].includes(metadata.status ?? '')
      ? metadata.status as SkillPublicationStatus : 'quarantined';
  const content = (match ? raw.slice(match[0].length) : raw).replace(/\r\n/g, '\n').trim();
  return {
    metadata, runtime, publicationStatus, legacy,
    content,
    ready: valid && content.length > 0
      && runtime !== 'unknown' && runtime !== 'dev-only' && publicationStatus === 'published',
  };
}
