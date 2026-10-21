import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseRuntimeSkill } from '@qitu/contracts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Read declared text resources only. Resources are versioned instructions, never executable tools. */
export function loadRuntimeSkillPackage(skillsRoot: string, id: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id)) throw new Error('SKILL_PACKAGE_ID_INVALID');
  const root = realpathSync(skillsRoot);
  const directory = resolve(root, id);
  if (relative(root, realpathSync(directory)) !== id) throw new Error('SKILL_PACKAGE_PATH_INVALID');
  const read = (resource: string): string => {
    const path = join(directory, ...resource.split('/'));
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || relative(directory, realpathSync(path)) !== join(...resource.split('/'))) {
      throw new Error('SKILL_PACKAGE_PATH_INVALID');
    }
    return readFileSync(path, 'utf8');
  };
  const raw = read('SKILL.md');
  const parsed = parseRuntimeSkill(id, raw, hash(raw.replace(/\r\n/g, '\n')));
  if (!parsed.ready || !parsed.metadata.references) return { ...parsed, packageDigest: hash(raw) };
  try {
    const paths = parsed.metadata.references.split(',').map(value => value.trim());
    if (new Set(paths).size !== paths.length || paths.some(path =>
      !/^references\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:md|json)$/.test(path))) throw new Error('SKILL_REFERENCE_INVALID');
    const resources = paths.map(path => ({ path, content: read(path) }));
    if (resources.some(resource => !resource.content.trim())) throw new Error('SKILL_REFERENCE_EMPTY');
    return {
      ...parsed,
      content: [parsed.content, ...resources.map(resource => `Resource ${resource.path}\n${resource.content}`)].join('\n\n'),
      packageDigest: hash(JSON.stringify({ source: raw, resources })),
    };
  } catch {
    return { ...parsed, ready: false, packageDigest: hash(raw) };
  }
}
