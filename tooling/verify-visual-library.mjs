import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const focused = process.argv.includes('--focused');
const typesOnly = process.argv.includes('--types-only');
const reuse = process.argv.slice(2).find((value) => !value.startsWith('--'));
if (typesOnly && !reuse) throw new Error('Types-only checks require an existing source build ID');
if (reuse && !/^run-[0-9]+-[0-9]+$/.test(reuse)) throw new Error('Invalid source build ID');
const runId = reuse ?? `run-${Date.now()}-${process.pid}`;
const directory = join(root, 'services/api/.tmp/visual-library', runId);
mkdirSync(directory, { recursive: true });
const tsc = require.resolve('typescript/bin/tsc');
const names = ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime'];
const output = (name) => join(root, 'packages', name, '.tmp/pbl-capability', runId, 'dist');
const paths = Object.fromEntries(names.map((name) => [`@qitu/${name}`, [join(output(name), 'index.d.ts')]]));
for (const name of names) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (typeof value?.types === 'string' && value.types.startsWith('./dist/')) {
      paths[key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`] = [join(output(name), value.types.slice(7))];
    }
  }
}
const externalPaths = {};
if (process.env.QITU_VISUAL_VALIDATION_DEPS) {
  const modules = join(process.env.QITU_VISUAL_VALIDATION_DEPS, 'node_modules');
  for (const name of ['pdfjs-dist', '@larksuiteoapi/node-sdk', 'mermaid']) {
    const folder = join(modules, name);
    const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    const types = manifest.types ?? manifest.typings;
    if (typeof types !== 'string') throw new Error(`Missing real declarations: ${name}`);
    externalPaths[name] = [join(folder, types)];
    externalPaths[`${name}/*`] = [join(folder, '*')];
  }
}
const steps = [];
function run(name, args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, env: { ...process.env, QITU_SOURCE_RUN_ID: runId }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 240000 });
  writeFileSync(join(directory, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  steps.push({ name, exitCode: result.status });
  process.stdout.write(`${name}: ${result.status === 0 ? 'PASS' : 'FAIL'}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  writeFileSync(join(directory, typesOnly ? 'types-result.json' : 'result.json'), JSON.stringify({ runId, scope: typesOnly ? 'five app source import graphs' : focused ? 'visual-assets, templates, platform-registry import graphs and five app import graphs' : 'full API and five app import graphs', steps }, null, 2));
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${name} failed`);
}
function compile(name, config, options, extra = {}) {
  const path = join(directory, `${name}.json`);
  const localPatterns = Object.fromEntries(Object.entries(extra).map(([key, value]) => [key,
    key === 'include' || key === 'exclude' ? value.map((pattern) => relative(directory, pattern).replaceAll('\\', '/')) : value]));
  writeFileSync(path, JSON.stringify({ extends: config, compilerOptions: { baseUrl: root, paths: { ...paths, ...externalPaths }, incremental: false, ...options }, ...localPatterns }));
  run(name, [tsc, '-p', path]);
}
for (const name of reuse ? [] : names) {
  compile(`build-${name}`, join(root, 'packages', name, name === 'agent-memory' ? 'tsconfig.json' : 'tsconfig.build.json'), { outDir: output(name) });
  if (name === 'contracts') run('contracts-esm', [join(root, 'tooling/fix-esm-extensions.mjs'), output(name)]);
}
if (!typesOnly) compile('api', join(root, 'services/api/tsconfig.json'), { outDir: join(directory, 'dist'), declaration: false }, focused ? {
  include: ['visual-assets', 'templates', 'platform-registry'].map((module) => join(root, 'services/api/src/modules', module, '**/*.ts')),
  exclude: [join(root, 'services/api/node_modules'), join(root, 'services/api/dist')],
} : {});
const files = ['visual-assets', 'templates', 'platform-registry'].flatMap((module) => {
  const folder = join(directory, 'dist/modules', module);
  return readdirSync(folder).filter((name) => name.endsWith('.test.js')).map((name) => relative(join(root, 'services/api'), join(folder, name)));
});

const appSources = {
  'admin-console': ['app/(console)/copilot/**/*.tsx', 'app/(console)/settings/**/*.tsx', 'lib/components/Visual*.tsx', 'lib/components/TemplateTeamBindingPanel.tsx', 'lib/components/knowledge-library/**/*.tsx'],
  'student-center': ['features/inspiration/**/*.tsx', 'features/today/**/*.tsx', 'features/tutor/**/*.tsx', 'features/growth/**/*.tsx', 'features/projects/**/*.tsx'],
  'parent-companion': ['features/**/*.tsx'],
  'teacher-workspace': ['app/(workspace)/dashboard/**/*.tsx', 'components/teacher-shell.tsx'],
  'auth-portal': ['app/login/**/*.tsx', 'app/page.tsx', 'app/public-shell.tsx'],
};
for (const [app, sources] of Object.entries(appSources)) {
  const appRoot = join(root, 'apps', app);
  const config = JSON.parse(readFileSync(join(appRoot, 'tsconfig.json'), 'utf8'));
  const aliases = Object.fromEntries(Object.entries(config.compilerOptions?.paths ?? {}).map(([key, values]) => [key, values.map((value) => resolve(appRoot, value))]));
  compile(`types-${app}`, join(appRoot, 'tsconfig.json'), { noEmit: true, paths: { ...aliases, ...externalPaths, '@qitu/contracts': [join(root, 'packages/contracts/src/index.ts')], '@qitu/auth': [join(root, 'packages/auth/src/index.tsx')], '@qitu/ui': [join(root, 'packages/ui/src/index.tsx')] } },
    { include: [join(appRoot, 'next-env.d.ts'), ...sources.map((source) => join(appRoot, source))], exclude: [join(appRoot, 'node_modules'), join(appRoot, '.next')] });
}
if (!typesOnly) run('api-behavior', ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href, '--test', '--test-concurrency=2', ...files], join(root, 'services/api'));
process.stdout.write(`PASS: ${relative(root, directory)}\n`);
