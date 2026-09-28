import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = [
  'apps/teacher-workspace/components/teacher-shell.tsx',
  'apps/teacher-workspace/app/(workspace)/dashboard/page.tsx',
  'apps/teacher-workspace/app/(workspace)/statistics/page.tsx',
];

const violations = [];
for (const relativePath of files) {
  const path = resolve(root, relativePath);
  const source = readFileSync(path, 'utf8');
  if (source.includes('href="/teacher/')) {
    violations.push(`${relativePath}: client Link href must omit basePath /teacher`);
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log(`teacher basePath guard: ${files.length} files passed`);
