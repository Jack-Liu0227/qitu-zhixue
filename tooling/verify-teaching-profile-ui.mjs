import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const steps = [];
const reportPath = join(root, 'services/api/.tmp/teaching-profile-ui-verification.json');
function run(name, args, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
  process.stdout.write(`\n${name}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  steps.push({ name, exitCode: result.status });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${name} failed`);
}
function files(directory, suffix) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path, suffix) : entry.name.endsWith(suffix) ? [path] : [];
  });
}
try {
  run('fresh-source-growth-regressions', [join(root, 'tooling/verify-profile-growth.mjs')]);
  const source = JSON.parse(readFileSync(join(root, 'services/api/.tmp/profile-growth-verification.json'), 'utf8'));
  const directory = join(root, source.directory);
  const env = { ...process.env, QITU_SOURCE_RUN_ID: source.runId };
  delete env.QITU_VERIFY_DEPENDENCY_ROOT;
  const loader = new URL('./verify-workspace-source.mjs', import.meta.url).href;
  for (const [appName, directories] of [
    ['admin-console', ['lib/components/teaching-binding']],
    ['student-center', ['features/profile', 'features/growth/components']],
  ]) {
    const app = join(root, 'apps', appName);
    const tests = directories.flatMap(path => files(join(app, path), '.test.ts'));
    if (!tests.length) throw new Error(`No focused behavior tests found for ${appName}`);
    const config = join(directory, `${appName}-behavior.json`);
    const output = join(directory, `${appName}-behavior`);
    const frontend = JSON.parse(readFileSync(join(directory, `${appName}.json`), 'utf8'));
    if (appName === 'admin-console') {
      const viewConfig = join(directory, 'teaching-arrangement-types.json');
      writeFileSync(viewConfig, JSON.stringify({ extends: join(app, 'tsconfig.json'),
        compilerOptions: frontend.compilerOptions,
        include: [join(app, 'next-env.d.ts'), join(app, 'app/(console)/settings/templates/**/*.tsx'),
          join(app, 'lib/components/TemplateTeamBindingPanel.tsx')],
        exclude: [join(app, 'node_modules')],
      }));
      run('teaching-arrangement-fresh-source-types', [require.resolve('typescript/bin/tsc'), '-p', viewConfig], env);
    }
    mkdirSync(output, { recursive: true });
    writeFileSync(config, JSON.stringify({ extends: join(app, 'tsconfig.json'),
      compilerOptions: { ...frontend.compilerOptions, module: 'NodeNext', moduleResolution: 'NodeNext',
        noEmit: false, outDir: output, rootDir: app, declaration: false, incremental: false },
      files: [join(app, 'next-env.d.ts'), ...tests], include: [], exclude: [join(app, 'node_modules')],
    }));
    run(`${appName}-test-build`, [require.resolve('typescript/bin/tsc'), '-p', config], env);
    run(`${appName}-behavior`, ['--import', loader, '--test', '--test-concurrency=2',
      ...tests.map(path => join(output, relative(app, path).replace(/\.ts$/u, '.js')))], env);
  }
  writeFileSync(reportPath, JSON.stringify({ success: true, runId: source.runId,
    finishedAt: new Date().toISOString(), steps }, null, 2));
  process.stdout.write('\nPASS: services/api/.tmp/teaching-profile-ui-verification.json\n');
} catch (error) {
  writeFileSync(reportPath, JSON.stringify({ success: false, finishedAt: new Date().toISOString(), steps }, null, 2));
  throw error;
}
