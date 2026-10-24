import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const runId = `run-${Date.now()}-${process.pid}`;
const directory = join(root, 'services/api/.tmp/pbl-capability', runId);
const packages = ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime'];
const paths = {};
const steps = [];
const output = name => join(root, 'packages', name, '.tmp/pbl-capability', runId, 'dist');
mkdirSync(directory, { recursive: true });
for (const name of packages) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  paths[manifest.name] = [join(output(name), 'index.d.ts')];
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (typeof value?.types === 'string' && value.types.startsWith('./dist/')) {
      paths[key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`] = [join(output(name), value.types.slice(7))];
    }
  }
}
function save(success) {
  writeFileSync(join(root, 'services/api/.tmp/exploration-tools-verification.json'), JSON.stringify({
    runId, directory: relative(root, directory), finishedAt: new Date().toISOString(), success, steps,
    scope: 'fresh dependency builds; tutor, tools, template and knowledge behavior; isolated project history fixture; four frontend type checks; no production database or provider probes',
  }, null, 2));
}
function run(name, args, cwd = root) {
  process.stdout.write(`\n${name}\n`);
  const env = { ...process.env, QITU_SOURCE_RUN_ID: runId, QITU_VERIFY_RUN_ID: runId };
  if (name !== 'postgres-fixture') delete env.QITU_VERIFY_DEPENDENCY_ROOT;
  const result = spawnSync(process.execPath, args, {
    cwd, env,
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000,
  });
  const log = join(directory, `${steps.length + 1}-${name}.log`);
  writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  steps.push({ name, exitCode: result.status, log: relative(root, log) });
  process.stdout.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (result.error || result.status !== 0) { save(false); throw result.error ?? new Error(`${name} failed`); }
}
function compile(name, config, overrides = {}) {
  const path = join(directory, `${name}.json`);
  writeFileSync(path, JSON.stringify({ extends: config, compilerOptions: {
    baseUrl: root, paths, incremental: false, ...overrides,
  } }));
  run(`build-${name}`, [require.resolve('typescript/bin/tsc'), '-p', path]);
}
const loader = new URL('./verify-workspace-source.mjs', import.meta.url).href;
for (const name of packages) {
  compile(name, join(root, 'packages', name, name === 'agent-memory' ? 'tsconfig.json' : 'tsconfig.build.json'), { outDir: output(name) });
  if (name === 'contracts') run('contracts-esm', [join(root, 'tooling/fix-esm-extensions.mjs'), output(name)]);
}
compile('api', join(root, 'services/api/tsconfig.json'), { outDir: join(directory, 'dist'), declaration: false });
const modules = ['ai-tutor', 'qitu-sdk', 'templates', 'platform-registry', 'knowledge', 'projects'];
const apiTests = modules.flatMap(name => readdirSync(join(directory, 'dist/modules', name))
  .filter(file => file.endsWith('.test.js') && !file.includes('integration'))
  .map(file => join(directory, 'dist/modules', name, file)));
run('teaching-tool-behavior', ['--import', loader, '--test', '--test-concurrency=2', ...apiTests], join(root, 'services/api'));
run('model-tool-events', ['--import', loader, '--test', join(output('model-runtime'), 'runtime.test.js')]);
run('postgres-fixture', [join(root, 'tooling/test-exploration-history.mjs')]);
for (const name of ['admin-console', 'student-center', 'teacher-workspace', 'parent-companion']) {
  const app = join(root, 'apps', name);
  const config = join(directory, `${name}.json`);
  writeFileSync(config, JSON.stringify({ extends: join(app, 'tsconfig.json'), compilerOptions: {
    incremental: false, noEmit: true, baseUrl: root, paths: { ...paths,
      '@qitu/api-client': [join(root, 'packages/api-client/src/index.ts')], '@qitu/ui': [join(root, 'packages/ui/src/index.tsx')] },
  } }));
  run(`${name}-types`, [require.resolve('typescript/bin/tsc'), '-p', config]);
}
save(true);
process.stdout.write('\nPASS: services/api/.tmp/exploration-tools-verification.json\n');
