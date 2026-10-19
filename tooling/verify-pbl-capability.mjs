import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = join(root, 'services/api/.tmp/pbl-capability');
const runId = `run-${Date.now()}-${process.pid}`;
const runDirectory = join(temporary, runId);
const loader = new URL('./verify-workspace-source.mjs', import.meta.url).href;
const tsc = require.resolve('typescript/bin/tsc');
const focused = process.argv.includes('--focused');
if (process.argv.slice(2).some((argument) => argument !== '--focused')) {
  throw new Error('Usage: node tooling/verify-pbl-capability.mjs [--focused]');
}
mkdirSync(temporary, { recursive: true });
mkdirSync(runDirectory, { recursive: true });

const packages = ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime'];
const packageOutput = (name) => join(root, 'packages', name, '.tmp/pbl-capability', runId, 'dist');
const paths = {};
for (const name of packages) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  paths[manifest.name] = [join(packageOutput(name), 'index.d.ts')];
  for (const [key, value] of Object.entries(manifest.exports ?? {})) {
    const typeTarget = typeof value === 'object' ? value.types : undefined;
    if (typeof typeTarget === 'string' && typeTarget.startsWith('./dist/')) {
      paths[key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`] = [join(packageOutput(name), typeTarget.slice('./dist/'.length))];
    }
  }
}
const steps = [];
const startedAt = new Date().toISOString();
function saveReport(success) {
  writeFileSync(join(temporary, 'verification.json'), JSON.stringify({
    schemaVersion: 1, mode: focused ? 'focused' : 'full', startedAt, finishedAt: new Date().toISOString(), success,
    resolution: 'isolated per-run package outputs via test-only registerHooks and declaration paths; installed snapshots and ordinary dist unchanged',
    runDirectory: relative(root, runDirectory),
    steps,
  }, null, 2) + '\n');
}
function run(name, args, cwd = root) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, QITU_SOURCE_RUN_ID: runId },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  const log = `${steps.length + 1}-${name.replace(/[^a-z0-9-]/gi, '-')}.log`;
  writeFileSync(join(runDirectory, log), output);
  steps.push({ name, command: ['node', ...args.map((argument) => argument.startsWith(root) ? relative(root, argument) : argument)],
    cwd: relative(root, cwd) || '.', exitCode: result.status, log: relative(root, join(runDirectory, log)) });
  if (result.status !== 0 || result.error) {
    saveReport(false);
    throw result.error ?? new Error(`${name} failed (${result.status})`);
  }
}
function compile(name, config, overrides = {}) {
  const generated = join(runDirectory, `${name}.json`);
  writeFileSync(generated, JSON.stringify({
    extends: config,
    compilerOptions: { baseUrl: root, paths, incremental: false, ...overrides },
  }, null, 2));
  run(`build-${name}`, [tsc, '-p', generated]);
}
for (const name of packages) {
  const config = name === 'agent-memory' ? 'tsconfig.json' : 'tsconfig.build.json';
  compile(name, join(root, 'packages', name, config), { outDir: packageOutput(name) });
  if (name === 'contracts') {
    run('contracts-esm-extensions', [join(root, 'tooling/fix-esm-extensions.mjs'), packageOutput(name)]);
  }
}

compile('api', join(root, 'services/api/tsconfig.json'), {
  outDir: join(runDirectory, 'dist'), declaration: false,
});

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? findTests(path) : entry.name.endsWith('.test.js') ? [path] : [];
  });
}
const focusDirectories = ['templates', 'learning-plan', 'ai-tutor', 'platform-registry', 'qitu-sdk'];
const testFiles = findTests(join(runDirectory, 'dist')).filter((file) => !focused ||
  focusDirectories.some((name) => file.includes(join('modules', name) + sep)));
if (testFiles.length === 0) throw new Error('No compiled API tests found');
const apiRoot = join(root, 'services/api');
run('api-behavior-tests', ['--import', loader, '--test', '--test-concurrency=4', ...testFiles.map((file) => relative(apiRoot, file))], apiRoot);

const assertions = [
  ['tutor-context.test.js', 'runTutorContextAssertions'], ['agent-runtime.test.js', 'runAgentRuntimeAssertions'],
  ['team-runtime.test.js', 'runTeamRuntimeAssertions'], ['mastery/mastery.test.js', 'runMasteryAssertions'],
  ['questions/questions.test.js', 'runQuestionAssertions'], ['grading/grading.test.js', 'runGradingAssertions'],
  ['quiz-bank/optics-quiz-bank.test.js', 'runOpticsQuizBankAssertions'], ['curriculum.test.js', 'runCurriculumAssertions'],
  ['qitu-sdk.test.js', 'runQituSDKAssertions'],
];
const assertionScript = assertions.map(([file, method]) =>
  `await (await import(${JSON.stringify(pathToFileURL(join(packageOutput('ai-client'), file)).href)})).${method}();`).join('\n');
run('ai-client-assertions', ['--import', loader, '--input-type=module', '-e', assertionScript], join(root, 'packages/ai-client'));
const clientTests = findTests(packageOutput('ai-client')).filter((file) =>
  /template|curriculum/.test(file) && !file.endsWith('curriculum.test.js'));
if (clientTests.length) run('ai-client-template-tests', ['--import', loader, '--test', ...clientTests.map((file) => relative(root, file))]);
run('documentation', [join(root, 'tooling/check-codex-plan.mjs')]);
saveReport(true);
console.log(`\nPASS: ${steps.length} source-build, behavior and documentation steps.`);
console.log('Report: services/api/.tmp/pbl-capability/verification.json');
