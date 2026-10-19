import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Test-only: verify freshly built packages, never rewrite copied UNC dependencies.
const packages = fileURLToPath(new URL('../packages/', import.meta.url));
const runId = process.env.QITU_SOURCE_RUN_ID;
if (runId !== undefined && !/^run-[0-9]+-[0-9]+$/.test(runId)) {
  throw new Error('Invalid isolated source verification run ID');
}
const workspaces = new Map();
for (const entry of readdirSync(packages, { withFileTypes: true })) {
  const root = join(packages, entry.name);
  const manifestPath = join(root, 'package.json');
  if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  workspaces.set(manifest.name, { root, manifest });
}

function defaultTarget(value) {
  if (typeof value === 'string') return value;
  return value?.default ?? value?.import ?? value?.require;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@qitu/')) return nextResolve(specifier, context);
    const parts = specifier.split('/');
    const name = parts.slice(0, 2).join('/');
    const workspace = workspaces.get(name);
    if (!workspace) throw new Error(`Unknown source workspace: ${name}`);
    const key = parts.length === 2 ? '.' : `./${parts.slice(2).join('/')}`;
    const { manifest, root } = workspace;
    const target = manifest.exports
      ? defaultTarget(manifest.exports[key])
      : key === '.' ? manifest.main : undefined;
    if (typeof target !== 'string' || !/^\.?\/?dist\//.test(target)) {
      throw new Error(`No built source export: ${specifier}`);
    }
    const nativePath = runId === undefined ? join(root, target)
      : join(root, '.tmp/pbl-capability', runId, 'dist', target.replace(/^\.\/?dist\//, ''));
    if (!existsSync(nativePath)) throw new Error(`Build the source workspace first: ${specifier}`);
    const targetSpecifier = context.conditions.includes('require') ? nativePath : pathToFileURL(nativePath).href;
    return nextResolve(targetSpecifier, context);
  },
});
