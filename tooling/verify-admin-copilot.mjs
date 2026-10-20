import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const runId = `run-${Date.now()}-${process.pid}`;
const directory = join(root, 'services/api/.tmp/pbl-capability', runId);
const tsc = require.resolve('typescript/bin/tsc');
const packages = ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime'];
const foundations = process.argv.includes('--foundations');
if (process.argv.slice(2).some(argument => argument !== '--foundations')) {
  throw new Error('Usage: node tooling/verify-admin-copilot.mjs [--foundations]');
}
const paths = {};
const steps = [];
mkdirSync(directory, { recursive: true });
const output = name => join(root, 'packages', name, '.tmp/pbl-capability', runId, 'dist');
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
  writeFileSync(join(root, 'services/api/.tmp/copilot-verification.json'), JSON.stringify({
    runId, finishedAt: new Date().toISOString(), success, steps,
    scope: foundations ? 'source dependencies, API + workers compilation, copilot/registry/growth/knowledge/tutor/SDK and worker behavior, admin page import graphs; fixtures only, no live provider/database calls'
      : 'source dependencies, API compilation, copilot + registry + runtime skill behavior, admin copilot and Skills import graphs; no live provider/database calls',
  }, null, 2));
}
function run(name, args, cwd = root) {
  process.stdout.write(`\n${name}\n`);
  const result = spawnSync(process.execPath, args, {
    cwd, env: { ...process.env, QITU_SOURCE_RUN_ID: runId }, encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024, timeout: 240000,
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
  run(`build-${name}`, [tsc, '-p', path]);
}
for (const name of packages) {
  compile(name, join(root, 'packages', name, name === 'agent-memory' ? 'tsconfig.json' : 'tsconfig.build.json'), { outDir: output(name) });
  if (name === 'contracts') run('contracts-esm', [join(root, 'tooling/fix-esm-extensions.mjs'), output(name)]);
}
compile('api', join(root, 'services/api/tsconfig.json'), { outDir: join(directory, 'dist'), declaration: false });
const modules = ['admin-copilot', 'platform-registry', ...(foundations ? ['growth', 'knowledge', 'ai-tutor', 'qitu-sdk', 'templates', 'learning-plan', 'team-runtime'] : [])];
const testFiles = modules.flatMap(name => {
  const path = join(directory, 'dist/modules', name);
  return readdirSync(path).filter(f => f.endsWith('.test.js')).map(f => join(path, f));
});
const runtimeTests = join(directory, 'dist/common/tutor-runtime');
testFiles.push(...readdirSync(runtimeTests).filter(f => f.endsWith('.test.js')).map(f => join(runtimeTests, f)));
const apiRoot = join(root, 'services/api');
run('behavior', ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href,
  '--test', '--test-concurrency=2', ...testFiles.map(p => relative(apiRoot, p))], apiRoot);
if (foundations) {
  const workerRoot = join(root, 'services/workers');
  const workerOutput = join(workerRoot, '.tmp/pbl-capability', runId, 'dist');
  compile('workers', join(workerRoot, 'tsconfig.json'), { outDir: workerOutput, noEmit: false, declaration: false });
  writeFileSync(join(workerOutput, 'package.json'), JSON.stringify({ type: 'module' }));
  run('workers-esm', [join(root, 'tooling/fix-esm-extensions.mjs'), workerOutput]);
  run('worker-behavior', ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href,
    '--test', '--test-concurrency=2', ...readdirSync(workerOutput).filter(f => f.endsWith('.test.js')).map(f => join(workerOutput, f))], workerRoot);
  run('model-runtime-behavior', ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href,
    '--test', ...readdirSync(output('model-runtime')).filter(f => f.endsWith('.test.js')).map(f => join(output('model-runtime'), f))]);
  run('sdk-behavior', ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href, '--input-type=module', '-e',
    `const { runQituSDKAssertions } = await import(${JSON.stringify(pathToFileURL(join(output('ai-client'), 'qitu-sdk.test.js')).href)}); await runQituSDKAssertions(); console.log('SDK assertions passed');`]);
}
const admin = join(root, 'apps/admin-console');
const config = join(directory, 'admin-copilot.json');
writeFileSync(config, JSON.stringify({
  extends: join(admin, 'tsconfig.json'),
  compilerOptions: { incremental: false, noEmit: true },
  include: [join(admin, 'next-env.d.ts'), join(admin, 'app/(console)/copilot/**/*.tsx'), join(admin, 'app/(console)/settings/skills/**/*.tsx'),
    ...(foundations ? [join(admin, 'app/(console)/settings/profile-growth/**/*.tsx'), join(admin, 'app/(console)/settings/tools/**/*.tsx')] : [])],
  exclude: [join(admin, 'node_modules')],
}));
run('admin-copilot-types', [tsc, '-p', config]);
if (foundations) {
  const student = join(root, 'apps/student-center');
  const studentConfig = join(directory, 'student-pbl.json');
  writeFileSync(studentConfig, JSON.stringify({
    extends: join(student, 'tsconfig.json'),
    compilerOptions: { incremental: false, noEmit: true },
    include: [join(student, 'next-env.d.ts'), ...['tutor', 'profile', 'growth'].map(name => join(student, 'features', name, '**/*.tsx'))],
    exclude: [join(student, 'node_modules')],
  }));
  run('student-pbl-types', [tsc, '-p', studentConfig]);
}
save(true);
process.stdout.write('\nPASS: services/api/.tmp/copilot-verification.json\n');
