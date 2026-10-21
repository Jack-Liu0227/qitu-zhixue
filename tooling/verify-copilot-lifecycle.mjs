import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const resume = process.argv[2]?.startsWith('--resume=') ? process.argv[2].slice(9) : null;
if (process.argv.length > 3 || process.argv[2] && !resume || resume && !/^run-\d+-\d+$/.test(resume)) throw new Error('Usage: verify-copilot-lifecycle.mjs [--resume=run-ID]');
const runId = resume ?? `run-${Date.now()}-${process.pid}`;
const directory = join(root, 'services/api/.tmp/pbl-capability', runId);
const packages = ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime'];
const paths = {};
const steps = [];
const resolutions = [];
let priorAttempt;
const output = name => join(root, 'packages', name, '.tmp/pbl-capability', runId, 'dist');
mkdirSync(directory, { recursive: true });
if (resume) {
  const recordPath = join(root, 'services/api/.tmp/copilot-lifecycle-verification.json');
  const previous = JSON.parse(readFileSync(recordPath, 'utf8'));
  if (previous.runId !== resume) throw new Error('Resume must name the last completed verification attempt');
  const startedAt = Number(resume.split('-')[1]);
  function unchanged(path) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const entry = join(path, item.name);
      if (item.isDirectory()) unchanged(entry);
      else if (statSync(entry).mtimeMs > startedAt) throw new Error('Workspace dependency source changed; start a fresh verification');
    }
  }
  for (const name of packages) {
    unchanged(join(root, 'packages', name, 'src'));
    if (!existsSync(join(output(name), 'index.d.ts'))) throw new Error(`Missing isolated dependency: ${name}`);
  }
  priorAttempt = join(directory, `prior-attempt-${Date.now()}.json`);
  writeFileSync(priorAttempt, JSON.stringify(previous, null, 2));
  steps.push(...previous.steps.filter(step => step.exitCode === 0 && (packages.some(name => step.name === `build-${name}`) || step.name === 'contracts-esm')));
  if (steps.length !== packages.length + 1) throw new Error('Dependency build steps did not all pass');
}
for (const name of packages) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  paths[manifest.name] = [join(output(name), 'index.d.ts')];
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (typeof value?.types === 'string' && value.types.startsWith('./dist/')) {
      paths[key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`] = [join(output(name), value.types.slice(7))];
    }
  }
}
// Copied UNC node_modules can lack a link while the exact declared SDK is installed.
const apiManifest = JSON.parse(readFileSync(join(root, 'services/api/package.json'), 'utf8'));
const sdkVersion = apiManifest.dependencies?.['@larksuiteoapi/node-sdk'];
if (typeof sdkVersion === 'string' && /^\d+\.\d+\.\d+$/.test(sdkVersion)) {
  const sdk = join(root, `node_modules/.pnpm/@larksuiteoapi+node-sdk@${sdkVersion}/node_modules/@larksuiteoapi/node-sdk`);
  if (existsSync(join(sdk, 'package.json'))) {
    const manifest = JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8'));
    const declarations = join(sdk, manifest.types ?? 'types', 'index.d.ts');
    if (manifest.version === sdkVersion && existsSync(declarations)) {
      paths['@larksuiteoapi/node-sdk'] = [declarations];
      resolutions.push(`API compile maps the real installed @larksuiteoapi/node-sdk@${sdkVersion} declarations; no install snapshot changes.`);
    }
  }
}
function save(success) {
  writeFileSync(join(root, 'services/api/.tmp/copilot-lifecycle-verification.json'), JSON.stringify({
    runId, success, finishedAt: new Date().toISOString(), resolutions, steps, priorAttempt: priorAttempt && relative(root, priorAttempt),
    scope: 'fresh workspace dependencies; API compilation; Copilot lifecycle, registry, Skill and template regressions; Admin import graphs. Synthetic data and temporary Skill files only; no production writes or live upstream calls.',
  }, null, 2));
}
function run(name, args, cwd = root) {
  process.stdout.write(`\n${name}\n`);
  const result = spawnSync(process.execPath, args, { cwd, env: { ...process.env, QITU_SOURCE_RUN_ID: runId },
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 240000 });
  const log = join(directory, `${resume ? `resume-${Date.now()}-` : ''}${steps.length + 1}-${name}.log`);
  writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  steps.push({ name, exitCode: result.status, log: relative(root, log) });
  process.stdout.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (result.error || result.status !== 0) { save(false); throw result.error ?? new Error(`${name} failed`); }
}
function compile(name, config, overrides) {
  const path = join(directory, `${name}.json`);
  writeFileSync(path, JSON.stringify({ extends: config, compilerOptions: { baseUrl: root, paths, incremental: false, ...overrides } }));
  run(`build-${name}`, [require.resolve('typescript/bin/tsc'), '-p', path]);
}
for (const name of resume ? [] : packages) {
  compile(name, join(root, 'packages', name, name === 'agent-memory' ? 'tsconfig.json' : 'tsconfig.build.json'), { outDir: output(name) });
  if (name === 'contracts') run('contracts-esm', [join(root, 'tooling/fix-esm-extensions.mjs'), output(name)]);
}
run('mcp-sdk-behavior', ['--test', relative(root, join(output('model-runtime'), 'mcp-streamable.test.js'))]);
compile('api', join(root, 'services/api/tsconfig.json'), { outDir: join(directory, 'dist'), declaration: false });
const api = join(root, 'services/api');
function moduleTests(module) {
  const path = join(directory, 'dist/modules', module);
  return readdirSync(path).filter(file => file.endsWith('.test.js')).map(file => relative(api, join(path, file)));
}
const runtimePath = join(directory, 'dist/common/tutor-runtime');
const first = [...moduleTests('admin-copilot'), ...moduleTests('platform-registry'),
  ...readdirSync(runtimePath).filter(file => file.endsWith('.test.js')).map(file => relative(api, join(runtimePath, file)))];
run('copilot-behavior', ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href,
  '--test', '--test-concurrency=2', ...first], api);
run('template-behavior', ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href,
  '--test', '--test-concurrency=2', ...['templates-governance.service.test.js', 'templates.content-validator.test.js',
    'templates.policy.test.js', 'templates.store.postgres.test.js'].map(name => relative(api, join(directory, 'dist/modules/templates', name)))], api);
run('configuration-bindings', ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href,
  '--test', '--test-concurrency=2', ...['templates-binding.service.test.js', 'templates-binding.drift.test.js',
    'teaching-bundle.draft.test.js', 'teaching-bundle.lifecycle.test.js', 'project-binding-recovery.test.js']
    .map(name => relative(api, join(directory, 'dist/modules/templates', name)))], api);
run('tutor-binding-boundaries', ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href,
  '--test', ...['tutor.project-context.test.js', 'tutor.team-resolution.test.js']
    .map(name => relative(api, join(directory, 'dist/modules/ai-tutor', name)))], api);
const admin = join(root, 'apps/admin-console');
const config = JSON.parse(readFileSync(join(admin, 'tsconfig.json'), 'utf8'));
const inherited = Object.fromEntries(Object.entries(config.compilerOptions?.paths ?? {}).map(([key, values]) =>
  [key, values.map(value => resolve(admin, value))]));
const adminConfig = join(directory, 'admin-lifecycle.json');
writeFileSync(adminConfig, JSON.stringify({ extends: join(admin, 'tsconfig.json'), compilerOptions: {
  incremental: false, noEmit: true, paths: { ...inherited, ...paths },
}, include: [join(admin, 'next-env.d.ts'), join(admin, 'app/(console)/copilot/**/*.tsx'),
  join(admin, 'app/(console)/settings/skills/**/*.tsx'), join(admin, 'app/(console)/settings/templates/**/*.tsx')], exclude: [join(admin, 'node_modules')] }));
run('admin-types', [require.resolve('typescript/bin/tsc'), '-p', adminConfig]);
const student = join(root, 'apps/student-center');
const studentConfig = join(directory, 'student-configuration.json');
const studentPaths = JSON.parse(readFileSync(join(student, 'tsconfig.json'), 'utf8')).compilerOptions?.paths ?? {};
const studentManifest = JSON.parse(readFileSync(join(student, 'package.json'), 'utf8'));
const mermaidLock = /mermaid:\r?\n\s+specifier: ([^\r\n]+)\r?\n\s+version: ([^\s(]+)/.exec(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
const studentDependencies = {};
if (mermaidLock?.[1] === studentManifest.dependencies?.mermaid) {
  const realMermaid = join(root, `node_modules/.pnpm/mermaid@${mermaidLock[2]}/node_modules/mermaid`);
  if (existsSync(join(realMermaid, 'package.json'))) {
    const manifest = JSON.parse(readFileSync(join(realMermaid, 'package.json'), 'utf8'));
    if (manifest.version === mermaidLock[2] && existsSync(join(realMermaid, manifest.types))) {
      studentDependencies.mermaid = [join(realMermaid, manifest.types)];
      resolutions.push(`Student compile resolves actual locked mermaid@${manifest.version} declarations; the UNC install snapshot is unchanged.`);
    }
  }
}
writeFileSync(studentConfig, JSON.stringify({ extends: join(student, 'tsconfig.json'), compilerOptions: {
  incremental: false, noEmit: true, paths: { ...Object.fromEntries(Object.entries(studentPaths).map(([key, values]) =>
    [key, values.map(value => resolve(student, value))])), ...paths, ...studentDependencies },
}, include: [join(student, 'next-env.d.ts'), join(student, 'features/tutor/TutorPage.tsx')], exclude: [join(student, 'node_modules')] }));
run('student-types', [require.resolve('typescript/bin/tsc'), '-p', studentConfig]);
save(true);
process.stdout.write('\nPASS: services/api/.tmp/copilot-lifecycle-verification.json\n');
