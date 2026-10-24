import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = process.argv.find(arg => arg.startsWith('--stage='))?.slice(8) ?? 'all';
assert(['scope', 'evidence', 'content', 'catalog', 'behavior', 'delivery', 'restore', 'all'].includes(stage), 'Unknown verification stage');
const issue = 'docs/issues/20261024-inspiration-eight-projects.md';
assert(existsSync(join(root, issue)), 'Implementation Issue is required');
assert(existsSync(join(root, 'docs/plan/codex/inspiration-eight-project-expansion-20261024.md')));
if (stage === 'scope') {
  console.log('Scope and implementation Issue verified; no runtime changes made.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const packages = ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime'];
const base = join(root, 'services/api/.tmp/inspiration-expansion');
mkdirSync(base, { recursive: true });
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = join(directory, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });
}
const dependencyFiles = packages.flatMap(name => files(join(root, 'packages', name, 'src')));
const sourceFiles = [...dependencyFiles, ...files(join(root, 'services/api/src'))];
function fingerprint(input, read = readFileSync) {
  const hash = createHash('sha256');
  for (const file of [...input].sort()) hash.update(relative(root, file)).update(read(file));
  return hash.digest('hex');
}
const digest = fingerprint(sourceFiles), dependencyDigest = fingerprint(dependencyFiles);
const cacheFile = join(base, 'build.json');
let cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
const cached = cache?.digest === digest && existsSync(join(base, cache.runId, 'dist'));
const runId = cached ? cache.runId : `run-${Date.now()}-${process.pid}`;
const directory = join(base, runId);
mkdirSync(directory, { recursive: true });
const dependencyCacheFile = join(base, 'dependencies.json');
const dependencyCache = existsSync(dependencyCacheFile) ? JSON.parse(readFileSync(dependencyCacheFile, 'utf8')) : null;
const reusableDependencies = dependencyCache?.digest === dependencyDigest && packages.every(name =>
  existsSync(join(root, 'packages', name, '.tmp/pbl-capability', dependencyCache.runId, 'dist/index.d.ts')));
const dependencyRunId = cached ? cache.dependencyRunId : reusableDependencies ? dependencyCache.runId : runId;
const output = name => join(root, 'packages', name, '.tmp/pbl-capability', dependencyRunId, 'dist');
const dependencyRoot = process.env.QITU_VERIFY_DEPENDENCY_ROOT ?? join(root, '.tmp/skill-lifecycle-deps');
const paths = {};
const sdkRequire = createRequire(join(dependencyRoot, 'package.json'));
const sdkManifestPath = sdkRequire.resolve('@larksuiteoapi/node-sdk/package.json');
const sdkManifest = JSON.parse(readFileSync(sdkManifestPath, 'utf8'));
assert.equal(sdkManifest.version, JSON.parse(readFileSync(join(root, 'services/api/package.json'), 'utf8')).dependencies['@larksuiteoapi/node-sdk']);
paths['@larksuiteoapi/node-sdk'] = [join(sdkManifestPath, '..', sdkManifest.types)];
for (const name of packages) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  paths[manifest.name] = [join(output(name), 'index.d.ts')];
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    if (typeof value?.types === 'string' && value.types.startsWith('./dist/')) {
      paths[key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`] = [join(output(name), value.types.slice(7))];
    }
  }
}
function run(name, args, cwd = root, environment = {}) {
  console.log(`Running ${name}`);
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, QITU_SOURCE_RUN_ID: dependencyRunId, QITU_VERIFY_DEPENDENCY_ROOT: dependencyRoot, ...environment } });
  const body = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  writeFileSync(join(directory, `${name}.log`), body);
  if (result.error || result.status !== 0) {
    process.stdout.write(body.slice(-18000));
    throw result.error ?? new Error(`${name} failed; log: ${relative(root, join(directory, `${name}.log`))}`);
  }
  console.log(body.split('\n').filter(line => /^(?:# |ℹ )(?:tests|pass|fail|duration)/.test(line)).slice(-6).join('\n') || `${name} passed`);
}
function compile(name, config, overrides, include) {
  const generated = join(directory, `${name}.json`);
  writeFileSync(generated, JSON.stringify({ extends: join(root, config), compilerOptions: {
    baseUrl: root, paths, incremental: false, ...overrides,
  }, ...(include ? { include } : {}) }, null, 2));
  run(`build-${name}`, [require.resolve('typescript/bin/tsc'), '-p', generated]);
}
if (!cached) {
  if (!reusableDependencies) {
    for (const name of packages) {
      compile(name, `packages/${name}/${name === 'agent-memory' ? 'tsconfig.json' : 'tsconfig.build.json'}`, { outDir: output(name) });
      if (name === 'contracts') run('contracts-extensions', [join(root, 'tooling/fix-esm-extensions.mjs'), output(name)]);
    }
    assert.equal(fingerprint(dependencyFiles), dependencyDigest, 'Dependency source changed during compilation; rerun');
    writeFileSync(dependencyCacheFile, JSON.stringify({ digest: dependencyDigest, runId: dependencyRunId }, null, 2));
  }
  const apiSource = join(root, 'services/api/src'), snapshot = join(directory, 'source');
  for (const file of sourceFiles.filter(file => file.startsWith(apiSource))) {
    const target = join(snapshot, relative(apiSource, file));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(file));
  }
  const capturedDigest = fingerprint(sourceFiles, file => file.startsWith(apiSource)
    ? readFileSync(join(snapshot, relative(apiSource, file))) : readFileSync(file));
  compile('api', 'services/api/tsconfig.json', { rootDir: snapshot, outDir: join(directory, 'dist'), declaration: false }, [join(snapshot, '**/*.ts')]);
  cache = { digest: capturedDigest, runId, dependencyRunId, builtAt: new Date().toISOString() };
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  if (fingerprint(sourceFiles) !== capturedDigest) console.log('Shared API files changed during validation; results apply to the immutable captured source, and the next run will refresh it.');
}
const tests = files(join(directory, 'dist/modules')).filter(file => file.endsWith('.test.js'));
const patterns = {
  evidence: /rubric-artifact|works-lesson-quality|works-learning-evidence|works.service.test|project-review.test|project-assessment.service.test|admin-ai-config.validation.test|team-runtime.gate/,
  content: /inspiration-catalog-content/,
  catalog: /inspiration-catalog-(bootstrap|module)/,
  behavior: /inspiration-course-fullflow|thunder-course-fullflow|wave-course-fullflow|guided-lesson-flow|learning-session-progress|project-learning-lifecycle/,
  delivery: /templates.service.test|inspiration-catalog|admin-copilot/,
  restore: /templates-restore|templates-governance.service.test|templates.policy.test|templates.store.postgres.test/,
  all: /templates|learning-plan|works|projects|mastery|platform-registry|team-runtime|ai-tutor/,
};
const selected = tests.filter(file => patterns[stage].test(relative(join(directory, 'dist/modules'), file)));
assert(selected.length, `No tests selected for ${stage}`);
const runtimeRoot = stage === 'all' ? null : mkdtempSync(join(tmpdir(), 'qitu-inspiration-runtime-'));
if (runtimeRoot) {
  const runtimeFiles = [join(root, 'AGENTS.md'), ...files(join(root, '.agents/skills'))];
  for (const file of runtimeFiles) {
    const target = join(runtimeRoot, relative(root, file));
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, readFileSync(file));
  }
}
const apiRoot = join(root, 'services/api');
run(`${stage}-tests`, ['--import', new URL('./verify-workspace-source.mjs', import.meta.url).href,
  '--test', '--test-concurrency=2', ...selected.map(file => relative(apiRoot, file))], apiRoot,
runtimeRoot ? { QITU_PROJECT_ROOT: runtimeRoot } : {});
writeFileSync(join(directory, `${stage}-result.json`), JSON.stringify({ stage, runId, digest: cache.digest, runtimeRoot,
  tests: selected.map(file => relative(directory, file)), success: true }, null, 2));
if (stage === 'delivery' || stage === 'restore') {
  const appPaths = { ...paths, '@qitu/ui': [join(root, 'packages/ui/src/index.tsx')],
    '@qitu/api-client': [join(root, 'packages/api-client/src/index.ts')],
    '@qitu/auth': [join(root, 'packages/auth/src/index.tsx')] };
  const pdfVersion = JSON.parse(readFileSync(join(root, 'apps/admin-console/package.json'), 'utf8')).dependencies['pdfjs-dist'];
  const pdfRoot = join(root, 'node_modules/.pnpm', `pdfjs-dist@${pdfVersion}`, 'node_modules/pdfjs-dist');
  const pdfManifest = JSON.parse(readFileSync(join(pdfRoot, 'package.json'), 'utf8'));
  assert.equal(pdfManifest.version, pdfVersion);
  appPaths['pdfjs-dist'] = [join(pdfRoot, pdfManifest.types)];
  appPaths['pdfjs-dist/legacy/build/pdf.mjs'] = [join(pdfRoot, pdfManifest.types)];
  for (const app of stage === 'restore' ? ['admin-console'] : ['student-center', 'admin-console']) {
    compile(`${app}-types`, `apps/${app}/tsconfig.json`, { noEmit: true, paths: appPaths });
  }
  if (stage === 'delivery') run('student-data-adapters', ['--test', 'tooling/test-student-pbl-data.mjs']);
  writeFileSync(join(directory, `${stage}-apps-result.json`), JSON.stringify({ runId,
    apps: stage === 'restore' ? ['admin-console'] : ['student-center', 'admin-console'],
    adapters: stage === 'restore' ? null : 'tooling/test-student-pbl-data.mjs', success: true }, null, 2));
}
console.log(`Verified ${stage}; ${relative(root, directory)}`);
