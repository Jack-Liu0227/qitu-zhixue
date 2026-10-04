import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('usage: node fix-esm-extensions.mjs <directory>');

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extname(path) === '.js') await fix(path);
  }
}

async function fix(path) {
  const source = await readFile(path, 'utf8');
  const fixed = source.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (match, prefix, specifier, suffix) => {
    if (specifier.endsWith('.js') || specifier.endsWith('.json')) return match;
    return `${prefix}${specifier}.js${suffix}`;
  });
  if (fixed !== source) await writeFile(path, fixed);
}

await walk(root);
