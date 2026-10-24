import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const prior = JSON.parse(readFileSync(join(root, 'services/api/.tmp/exploration-tools-verification.json'), 'utf8'));
if (!prior.steps.some(step => step.name === 'postgres-fixture' && step.exitCode === 0)) throw new Error('Fresh source verification is required before checking interfaces.');
const paths = {};
for (const name of ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime']) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  const output = join(root, 'packages', name, '.tmp/pbl-capability', prior.runId, 'dist');
  paths[manifest.name] = [join(output, 'index.d.ts')];
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (typeof value?.types === 'string' && value.types.startsWith('./dist/')) paths[key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`] = [join(output, value.types.slice(7))];
  }
}
const directory = join(root, 'services/api/.tmp/interface-verification');
mkdirSync(directory, { recursive: true });
const steps = [];
for (const name of ['admin-console', 'student-center', 'teacher-workspace', 'parent-companion']) {
  const config = join(directory, `${name}.json`);
  writeFileSync(config, JSON.stringify({ extends: join(root, 'apps', name, 'tsconfig.json'), compilerOptions: {
    incremental: false, noEmit: true, baseUrl: root, paths: { ...paths,
      '@qitu/api-client': [join(root, 'packages/api-client/src/index.ts')], '@qitu/ui': [join(root, 'packages/ui/src/index.tsx')] },
  } }));
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', config], { cwd: root, encoding: 'utf8', timeout: 180000 });
  process.stdout.write(`${name}: ${result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  steps.push({ name, exitCode: result.status });
}
const success = steps.every(step => step.exitCode === 0);
writeFileSync(join(directory, 'result.json'), JSON.stringify({ sourceRunId: prior.runId, finishedAt: new Date().toISOString(), success, steps }, null, 2));
if (!success) process.exitCode = 1;
