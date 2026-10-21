import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Browser-only fixture host. It serves the actual workspace components without an API proxy.
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'services/api/.tmp/configuration-browser');
mkdirSync(out, { recursive: true });
const { runId } = JSON.parse(readFileSync(join(root, 'services/api/.tmp/copilot-lifecycle-verification.json'), 'utf8'));
process.env.QITU_SOURCE_RUN_ID = runId;
await import('./verify-workspace-source.mjs');
const { configurationBindingFixture } = require(join(root, 'services/api/.tmp/pbl-capability', runId,
  'dist/modules/templates/configuration-binding.test-fixture.js'));
const fixture = await configurationBindingFixture();
writeFileSync(join(out, 'fixtures.json'), JSON.stringify({ template: fixture.template, team: fixture.team, draft: fixture.draft }));
const assertions = `const assert = { equal: (a,b) => { if (a !== b) throw new Error('Expected '+JSON.stringify(a)+' to equal '+JSON.stringify(b)); },
  ok: value => { if (!value) throw new Error('Expected a truthy value'); },
  deepEqual: (a,b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Values differ: '+JSON.stringify(a)); } };`;
const browserTest = readFileSync(join(root, 'tooling/test-configuration-browser.mjs'), 'utf8')
  .replace(/^import .*;\r?$/gm, '')
  .replace('export default async function verifyConfigurationBrowser(page) {', `async function verifyConfigurationBrowser(page) {\n${assertions}`)
  .replace(/const fixture = JSON\.parse\(readFileSync\(.*?\), 'utf8'\)\);/, "const fixture = await (await page.request.get('http://127.0.0.1:3204/fixtures.json')).json();")
  .replace(/^    writeFileSync\(.*;\r?$/gm, '');
writeFileSync(join(out, 'playwright-test.js'), browserTest);
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import TemplatePage from ${JSON.stringify(join(root, 'apps/admin-console/app/(console)/settings/templates/page.tsx'))};
import { useCopilotModel } from ${JSON.stringify(join(root, 'apps/admin-console/lib/copilot/use-copilot-model.ts'))};
function Model() {
  const m = useCopilotModel();
  return <main><h1>管家默认模型</h1><select aria-label="管家默认模型" value={m.selectedModel} disabled={m.modelLoading || m.modelSaving} onChange={e => void m.handleModelChange(e.target.value)}>
    <option value="">请选择默认模型</option>{m.availableModels.map(row => <option key={JSON.stringify([row.providerId,row.id])} value={JSON.stringify([row.providerId,row.id])}>{row.providerName} / {row.name}</option>)}
  </select>{!m.modelIsDefault && m.selectedModel && <button disabled={m.modelLoading || m.modelSaving} onClick={() => void m.handleModelChange(m.selectedModel)}>设为默认</button>}
  <p role="status">{m.modelNotice}</p>{m.modelError && <p role="alert">{m.modelError}</p>}<button disabled={m.modelSaving} onClick={() => void m.reloadModels()}>重新加载模型</button></main>;
}
createRoot(document.getElementById('root')).render(location.pathname === '/model' ? <Model/> : <TemplatePage/>);
`;
await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser',
  format: 'esm', jsx: 'automatic', outfile: join(out, 'app.js'),
  alias: { '@qitu/ui': join(root, 'packages/ui/src/index.tsx'), '@qitu/contracts': join(root, 'packages/contracts/src/index.ts'),
    '@qitu/api-client': join(root, 'packages/api-client/src/index.ts') },
  define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' });
const html = '<!doctype html><html lang="zh"><meta charset="utf-8"><title>Configuration fixture</title><style>body{font:15px system-ui;margin:24px}button,select,input{margin:6px;padding:8px}section{border:1px solid #ccd6e0;padding:16px;margin:12px}textarea{box-sizing:border-box}</style><div id="root"></div><script type="module" src="/app.js"></script></html>';
writeFileSync(join(out, 'index.html'), html);
const server = createServer((request, response) => {
  if (request.url?.startsWith('/api/')) { response.writeHead(404); response.end('Fixture API must be intercepted'); return; }
  const asset = request.url === '/app.js' ? 'app.js' : request.url === '/app.css' ? 'app.css' : request.url === '/fixtures.json' ? 'fixtures.json' : 'index.html';
  try { response.writeHead(200, { 'content-type': asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.json') ? 'application/json' : asset.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); response.end(readFileSync(join(out, asset))); }
  catch { response.writeHead(404); response.end(); }
});
server.listen(3204, '127.0.0.1', () => process.stdout.write('Configuration browser fixture: http://127.0.0.1:3204\n'));
