import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = join(root, 'services/api/.tmp/pbl-capability');
const resume = process.argv.find(argument => argument.startsWith('--resume='))?.slice(9);
if (resume && !/^run-\d+-\d+$/.test(resume)) throw new Error('Invalid verification run ID');
const runId = resume ?? `run-${Date.now()}-${process.pid}`;
const runDirectory = join(temporary, runId);
const loader = new URL('./verify-workspace-source.mjs', import.meta.url).href;
const tsc = require.resolve('typescript/bin/tsc');
const currentOnly = process.argv.includes('--current');
if (process.argv.slice(2).some(argument => argument !== '--current' && argument !== `--resume=${resume}`)) {
  throw new Error('Usage: node tooling/verify-tutor-lessons.mjs [--current] [--resume=run-ID]');
}
mkdirSync(temporary, { recursive: true });
mkdirSync(runDirectory, { recursive: true });

const packages = ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime'];
const packageOutput = (name) => join(root, 'packages', name, '.tmp/pbl-capability', runId, 'dist');
const paths = {};
const dependencyRoot = process.env.QITU_VERIFY_DEPENDENCY_ROOT;
if (dependencyRoot) {
  const dependencies = createRequire(join(dependencyRoot, 'package.json'));
  const manifestPath = dependencies.resolve('@larksuiteoapi/node-sdk/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const declared = JSON.parse(readFileSync(join(root, 'services/api/package.json'), 'utf8')).dependencies['@larksuiteoapi/node-sdk'];
  if (manifest.version !== declared) throw new Error('External verification SDK must exactly match the declared dependency');
  paths['@larksuiteoapi/node-sdk'] = [join(manifestPath, '..', manifest.types)];
  const pdfManifestPath = dependencies.resolve('pdfjs-dist/package.json');
  const pdf = JSON.parse(readFileSync(pdfManifestPath, 'utf8'));
  const pdfDeclared = JSON.parse(readFileSync(join(root, 'apps/admin-console/package.json'), 'utf8')).dependencies['pdfjs-dist'];
  if (pdf.version !== pdfDeclared) throw new Error('External verification PDF.js must match the declared dependency');
  paths['pdfjs-dist'] = [join(pdfManifestPath, '..', pdf.types)];
  paths['pdfjs-dist/legacy/build/pdf.mjs'] = [join(pdfManifestPath, '..', 'legacy/build/pdf.d.mts')];
}
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
if (resume) {
  const previous = JSON.parse(readFileSync(join(temporary, 'verification.json'), 'utf8'));
  if (!previous.runDirectory.endsWith(resume)) throw new Error('Resume must name the last verification attempt');
  const checkSource = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) checkSource(path);
      else if (statSync(path).mtimeMs > Number(resume.split('-')[1])) throw new Error('Dependency source changed; start a fresh build');
    }
  };
  for (const name of packages) {
    checkSource(join(root, 'packages', name, 'src'));
    if (!existsSync(join(packageOutput(name), 'index.d.ts'))) throw new Error(`Missing isolated dependency ${name}`);
  }
  const prior = previous.steps.filter(step => step.exitCode === 0 && (step.name === 'contracts-esm-extensions'
    || packages.some(name => step.name === `build-${name}`)));
  if (prior.length !== packages.length + 1) throw new Error('Cannot reuse unsuccessful dependency builds');
  writeFileSync(join(runDirectory, `prior-attempt-${Date.now()}.json`), JSON.stringify(previous, null, 2));
  steps.push(...prior);
}
function saveReport(success) {
  writeFileSync(join(temporary, 'verification.json'), JSON.stringify({
    schemaVersion: 1, mode: currentOnly ? 'tutor-lessons-current' : 'tutor-lessons', startedAt, finishedAt: new Date().toISOString(), success,
    resolution: 'isolated per-run package outputs via test-only registerHooks and declaration paths; installed snapshots and ordinary dist unchanged',
    runDirectory: relative(root, runDirectory),
    externalDependencyRoot: dependencyRoot ?? null,
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
for (const name of resume ? [] : packages) {
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
const focusDirectories = ['templates', 'learning-plan', 'ai-tutor', 'projects', 'works', 'platform-registry', 'qitu-sdk', 'team-runtime'];
const currentNames = new Set(['wave-course-fullflow', 'tutor-exploration', 'wave-course-authoring', 'lesson-collaboration-scope', 'team-runtime.student-status', 'team-runtime.session-routing', 'team-runtime.protocol', 'team-runtime.gate', 'lesson-collaboration', 'wave-teaching-resources', 'wave-optics-experiment', 'wave-optics-model', 'wave-optics-curriculum', 'tutor-activity-optics', 'guided-lesson-flow', 'lesson-activity-progress', 'gateway-tutor.provider', 'tutor-disclosure',
  'assistant-runtime', 'runtime-source', 'catalog-skills', 'team-version', 'team-version.runtime',
  'tutor-lesson-activity', 'tutor-lesson-activity.feedback', 'tutor-lesson-assessment.service', 'tutor-opening', 'tutor-teaching-context', 'tutor.runtime-identity', 'tutor.team-resolution',
  'tutor.service', 'learning-session-progress', 'optics-fullflow', 'works-learning-evidence', 'works-lesson-quality',
  'teaching-bundle.compiler', 'teaching-bundle.draft', 'templates-binding.service', 'optics-template-bootstrap']);
const testFiles = findTests(join(runDirectory, 'dist')).filter(file =>
  currentOnly ? currentNames.has(file.split(sep).at(-1).replace(/\.test\.js$/, ''))
    : focusDirectories.some(name => file.includes(join('modules', name) + sep)));
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
{
  for (const app of ['student-center', 'teacher-workspace', 'admin-console']) {
    compile(`${app}-types`, join(root, 'apps', app, 'tsconfig.json'), {
      noEmit: true, paths: { '@qitu/ui': [join(root, 'packages/ui/src/index.tsx')],
        '@qitu/auth': [join(root, 'packages/auth/src/index.tsx')], ...paths },
    });
  }
  run('student-pbl-data-tests',['--test','tooling/test-student-pbl-data.mjs']);
  run('student-live-boundary-tests',['--test','tooling/test-tutor-live-boundary.mjs']);
}
const workerOutput = join(runDirectory, 'workers');
compile('workers', join(root, 'services/workers/tsconfig.json'), { outDir: workerOutput });
run('workers-esm-extensions', [join(root, 'tooling/fix-esm-extensions.mjs'), workerOutput]);
const workerTests = findTests(workerOutput).filter(file => file.includes('team-runtime'));
if (workerTests.length) run('team-worker-tests', ['--import', loader, '--test', ...workerTests], join(root, 'services/workers'));
saveReport(true);
console.log(`\nPASS: ${steps.length} source-build, owner behavior and app typecheck steps.`);
console.log('Report: services/api/.tmp/pbl-capability/verification.json');
