import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = join(root, '.tmp', 'skill-lifecycle');
mkdirSync(temporary, { recursive: true });
const packages = readdirSync(join(root, 'packages')).flatMap(name => {
  const directory = join(root, 'packages', name);
  const path = join(directory, 'package.json');
  return existsSync(path) ? [{ directory, manifest: JSON.parse(readFileSync(path, 'utf8')) }] : [];
});
const paths = {};
const dependencyRoot = resolve(root, process.env.QITU_VERIFY_DEPENDENCY_ROOT ?? '.tmp/skill-lifecycle-deps');
if (existsSync(join(dependencyRoot, 'node_modules/@larksuiteoapi/node-sdk/package.json'))) {
  process.env.QITU_VERIFY_DEPENDENCY_ROOT = dependencyRoot;
  paths['@larksuiteoapi/node-sdk'] = [join(dependencyRoot, 'node_modules/@larksuiteoapi/node-sdk/types/index.d.ts')];
}
for (const { directory, manifest } of packages) {
  for (const [key, target] of Object.entries(manifest.exports ?? { '.': manifest.main })) {
    const value = typeof target === 'string' ? target : target.default ?? target.import ?? target.require;
    if (typeof value !== 'string' || !value.includes('dist/')) continue;
    const id = key === '.' ? manifest.name : manifest.name + key.slice(1);
    paths[id] = [join(directory, value.replace(/\.js$/, '.d.ts'))];
  }
}
const tsc = join(root, 'node_modules/typescript/bin/tsc');
const built = [];
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function build(directory, name, options = {}) {
  const config = name !== 'api' && existsSync(join(directory, 'tsconfig.build.json')) ? 'tsconfig.build.json' : 'tsconfig.json';
  const path = join(temporary, name + '.json');
  writeFileSync(path, JSON.stringify({ extends: join(directory, config), compilerOptions: {
    baseUrl: root, paths, noEmit: false, declaration: true, ...options,
  } }, null, 2));
  process.stdout.write(`Building source ${name}\n`);
  run([tsc, '-p', path]);
  built.push(name);
}
function checkFrontend() {
  build(join(root, 'apps/student-center'), 'student-center', { noEmit: true, declaration: false, incremental: false,
    paths: { ...paths, '@qitu/ui': [join(root, 'packages/ui/src/index.tsx')], '@qitu/ai-client': [join(root, 'packages/ai-client/src/index.ts')] } });
}
if (process.argv.includes('--frontend-only')) { checkFrontend(); process.exit(0); }
if (process.argv.includes('--typecheck-only')) {
  build(join(root, 'services/api'), 'api', { noEmit: true, declaration: false, incremental: false });
  build(join(root, 'services/workers'), 'workers', { noEmit: true, declaration: false, incremental: false });
  checkFrontend();
  writeFileSync(join(temporary, 'typecheck.json'), JSON.stringify({ result: 'passed', built, verifiedAt: new Date().toISOString() }, null, 2));
  process.exit(0);
}
if (!process.argv.includes('--skip-packages')) {
  for (const name of ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime']) {
    build(join(root, 'packages', name), name);
  }
}
if (process.argv.includes('--packages-only')) process.exit(0);
if (!process.argv.includes('--test-only')) {
  build(join(root, 'services/api'), 'api', { outDir: join(root, 'services/api/.tmp/test-dist'), incremental: false });
  build(join(root, 'services/workers'), 'workers', { outDir: join(root, 'services/workers/.tmp/skill-lifecycle'), incremental: false });
}
const hook = join(root, 'tooling/verify-workspace-source.mjs');
const api = join(root, 'services/api/.tmp/test-dist');
const worker = join(root, 'services/workers/.tmp/skill-lifecycle');
run([join(root, 'tooling/fix-esm-extensions.mjs'), worker]);
const tests = [
  join(root, 'packages/model-runtime/dist/skill-package.test.js'),
  join(api, 'common/tutor-runtime/runtime-source.test.js'),
  join(api, 'common/tutor-runtime/catalog-skills.test.js'),
  join(api, 'modules/admin-copilot/copilot.references.test.js'),
  join(api, 'modules/admin-copilot/copilot.resources.test.js'),
  join(api, 'modules/templates/skill-lifecycle.test.js'),
  join(api, 'modules/templates/teaching-bundle.compiler.test.js'),
  join(api, 'modules/ai-tutor/tutor-lesson-activity.test.js'),
  join(api, 'modules/ai-tutor/tutor-projection-event.test.js'),
  join(api, 'modules/growth/skill-lifecycle.test.js'),
  join(api, 'modules/growth/growth-projection-expression-flow.test.js'),
  join(api, 'modules/works/artifact-format.test.js'),
  join(api, 'modules/platform-registry/team-version.test.js'),
  join(api, 'modules/ai-tutor/tutor.runtime-identity.test.js'),
  join(api, 'modules/learning-plan/optics-fullflow.test.js'),
  join(worker, 'team-runtime-executor.test.js'),
  join(worker, 'team-runtime-projection-source.test.js'),
];
run(['--import', pathToFileURL(hook).href, '--test', ...tests.map(path => relative(root, path).replace(/\\/g, '/'))]);
if (!process.argv.includes('--backend-only')) {
  checkFrontend();
}
writeFileSync(join(temporary, 'verification.json'), JSON.stringify({ built, tests: tests.map(path => relative(root, path).replace(/\\/g, '/')), result: 'passed',
  verifiedAt: new Date().toISOString(), dependencyResolution: 'built_workspace_declarations_and_test_hook',
  liveRequest: 'not_probed' }, null, 2));
