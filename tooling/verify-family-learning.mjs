import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const steps = [];
function run(name, args, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
  process.stdout.write(`\n${name}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  steps.push({ name, status: result.status });
  if (result.error || result.status !== 0) throw result.error ?? new Error(name);
}
if (!process.argv.includes('--reuse-packages')) run('growth-owner-regressions', [join(root, 'tooling/verify-profile-growth.mjs')]);
const source = JSON.parse(readFileSync(join(root, 'services/api/.tmp/profile-growth-verification.json'), 'utf8'));
const directory = join(root, source.directory);
if (!source.success) throw new Error('Fresh source package verification must pass before reuse');
run('http-request-keys', ['--test', join(root, 'tooling/idempotency.test.mjs')]);
if (process.argv.includes('--reuse-packages')) run('api-rebuild', [require.resolve('typescript/bin/tsc'), '-p', join(directory, 'api.json')]);
const env = { ...process.env, QITU_SOURCE_RUN_ID: source.runId };
const loader = new URL('./verify-workspace-source.mjs', import.meta.url).href;
const tests = ['learning-insights', 'parent', 'teacher', 'feedback'].flatMap(module => {
  const folder = join(directory, 'dist/modules', module);
  return readdirSync(folder).filter(file => file.endsWith('.test.js')).map(file => join(folder, file));
});
tests.push(join(directory, 'dist/modules/projects/ui-read-model.test.js'));
run('family-learning-behavior', ['--import', loader, '--test', '--test-concurrency=2', ...tests], env);
const config = JSON.parse(readFileSync(join(directory, 'student-center.json'), 'utf8'));
for (const name of ['student-center', 'parent-companion', 'teacher-workspace', 'auth-portal']) {
  const file = join(directory, `${name}-all.json`);
  writeFileSync(file, JSON.stringify({ extends: join(root, 'apps', name, 'tsconfig.json'),
    compilerOptions: { ...config.compilerOptions, paths: { ...config.compilerOptions.paths,
      '@qitu/api-client': [join(root, 'packages/api-client/src/index.ts')],
      '@qitu/ui': [join(root, 'packages/ui/src/index.tsx')] } } }));
  run(`${name}-types`, [require.resolve('typescript/bin/tsc'), '-p', file], env);
}
writeFileSync(join(root, 'services/api/.tmp/family-learning-verification.json'), JSON.stringify({ success: true, runId: source.runId, steps }, null, 2));
