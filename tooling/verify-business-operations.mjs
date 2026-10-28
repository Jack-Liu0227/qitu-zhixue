import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const registrationOnly = process.argv.includes('--registration-only');
const resume = process.argv.find((s) => s.startsWith('--resume='))?.slice(9);
if (resume && !/^run-\d+-\d+$/.test(resume)) throw new Error('Invalid verification run');
const runId = resume ?? `run-${Date.now()}-${process.pid}`;
const directory = join(root, 'services/api/.tmp/pbl-capability', runId);
mkdirSync(directory, { recursive: true });
const output = (name) => join(root, 'packages', name, '.tmp/pbl-capability', runId, 'dist');
const packages = ['contracts', 'database', 'infra', 'agent-memory', 'ai-client', 'model-runtime'];
const paths = {};
const sdkRoot = join(
  root,
  'node_modules/.pnpm/@larksuiteoapi+node-sdk@1.76.0/node_modules/@larksuiteoapi/node-sdk',
);
const sdkManifest = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8'));
paths['@larksuiteoapi/node-sdk'] = [join(sdkRoot, sdkManifest.types ?? 'types', 'index.d.ts')];
const pdfRoot = join(root, 'node_modules/.pnpm/pdfjs-dist@6.4.299/node_modules/pdfjs-dist');
paths['pdfjs-dist'] = [join(pdfRoot, 'types/src/pdf.d.ts')];
paths['pdfjs-dist/legacy/build/pdf.mjs'] = [join(pdfRoot, 'types/src/pdf.d.ts')];
for (const name of packages) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  paths[manifest.name] = [join(output(name), 'index.d.ts')];
  for (const [key, value] of Object.entries(manifest.exports ?? {}))
    if (value?.types?.startsWith('./dist/'))
      paths[key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`] = [
        join(output(name), value.types.slice(7)),
      ];
}
const priorReport = resume
  ? JSON.parse(readFileSync(join(root, 'services/api/.tmp/business-verification.json'), 'utf8'))
  : undefined;
const steps =
  priorReport?.runId === runId
    ? priorReport.steps.filter(
        (step) => step.name.startsWith('build-') || step.name === 'contracts-esm',
      )
    : [];
function run(name, args) {
  process.stdout.write(`${name}\n`);
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, DATABASE_URL: '', QITU_SOURCE_RUN_ID: runId },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: name === 'behavior' ? 900000 : 300000,
    windowsHide: true,
  });
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  writeFileSync(join(directory, `${name}.log`), log);
  steps.push({ name, exitCode: r.status });
  writeFileSync(
    join(root, 'services/api/.tmp/business-verification.json'),
    JSON.stringify(
      {
        runId,
        directory,
        steps,
        resolution: 'Current source packages, isolated outputs; copied UNC installation unchanged',
      },
      null,
      2,
    ),
  );
  if (r.error || r.status !== 0) {
    process.stdout.write(log);
    throw r.error ?? new Error(`${name} failed`);
  }
}
function compile(name, config, compilerOptions = {}, extra = {}) {
  const file = join(directory, `${name}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      extends: config,
      compilerOptions: { baseUrl: root, paths, incremental: false, ...compilerOptions },
      ...extra,
    }),
  );
  run(name, [require.resolve('typescript/bin/tsc'), '-p', file]);
}
for (const name of packages) {
  if (resume) continue;
  compile(
    `build-${name}`,
    join(root, 'packages', name, name === 'agent-memory' ? 'tsconfig.json' : 'tsconfig.build.json'),
    { outDir: output(name) },
  );
  if (name === 'contracts')
    run('contracts-esm', [join(root, 'tooling/fix-esm-extensions.mjs'), output(name)]);
}
compile('api', join(root, 'services/api/tsconfig.json'), {
  outDir: join(directory, 'dist'),
  declaration: false,
}, registrationOnly ? { include: [
  'modules/business/**/*.ts', 'modules/identity-auth/**/*.ts', 'modules/directory/account*.ts',
  'common/audit/audit.module.ts', 'common/idempotency/idempotency.module.ts',
  'common/redis/redis.module.ts', 'health/health.module.ts',
].map(pattern => `../../../src/${pattern}`) } : {});
const sourcePaths = {
  ...paths,
  '@qitu/contracts': [join(root, 'packages/contracts/src/index.ts')],
  '@qitu/api-client': [join(root, 'packages/api-client/src/index.ts')],
  '@qitu/ui': [join(root, 'packages/ui/src/index.tsx')],
  '@qitu/auth': [join(root, 'packages/auth/src/index.tsx')],
};
for (const app of ['admin-console', 'parent-companion', 'auth-portal']) {
  const appRoot = join(root, 'apps', app);
  const config = JSON.parse(readFileSync(join(appRoot, 'tsconfig.json'), 'utf8'));
  const aliases = Object.fromEntries(
    Object.entries(config.compilerOptions?.paths ?? {}).map(([key, value]) => [
      key,
      value.map((v) => resolve(appRoot, v)),
    ]),
  );
  compile(`types-${app}`, join(appRoot, 'tsconfig.json'), {
    noEmit: true,
    paths: { ...aliases, ...sourcePaths },
  });
}
if (!process.argv.includes('--types-only')) {
  const tests = (registrationOnly ? ['business', 'identity-auth', 'directory'] : [
    'business',
    'projects',
    'learning-plan',
    'identity-auth',
    'directory',
    'model-registry',
  ]).flatMap((module) => {
    const folder = join(directory, 'dist/modules', module);
    return readdirSync(folder)
      .filter(
        (s) =>
          s.endsWith('.test.js') && (module !== 'model-registry' || s.startsWith('model-gateway.')) &&
          (module !== 'directory' || s.startsWith('account-registration.')),
      )
      .map((s) => join(folder, s));
  });
  run('behavior', [
    '--import',
    new URL('./verify-workspace-source.mjs', import.meta.url).href,
    '--test',
    '--test-concurrency=3',
    '--test-timeout=120000',
    ...tests.map((file) => relative(root, file)),
  ]);
}
process.stdout.write(`PASS ${runId}\n`);
