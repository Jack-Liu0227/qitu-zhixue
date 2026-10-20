import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const directory = join(root, '.tmp/visual-preview');
await mkdir(join(directory, 'src'), { recursive: true });
await writeFile(join(directory, 'src/index.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {VisualAssetPicker} from '../../../apps/admin-console/lib/components/VisualAssetPicker';
import {VisualDefaultsPanel} from '../../../apps/admin-console/lib/components/VisualDefaultsPanel';
import {AssistantGlyph,VisualAsset} from '../../../packages/ui/src/index';
import '../../../packages/ui/src/styles.css';
function App(){
 const [open,setOpen]=React.useState(false);
 return <main style={{padding:24}}><h1>素材库隔离验证</h1><p>使用独立测试对象验证选择与保存。</p>
 <AssistantGlyph value="asset:avatar-general-v1" size={64}/><button onClick={()=>setOpen(true)}>打开头像库</button>
 {open&&<VisualAssetPicker owners={[{kind:'assistant',id:'fixture-a'},{kind:'assistant',id:'fixture-b'}]} usage="avatar" onClose={()=>setOpen(false)}/>}
 <VisualDefaultsPanel/><VisualAsset assetId="cover-optics-v1" size={180} width={320}/></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`);
await writeFile(join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual library validation</title><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script></html>');
await build({ entryPoints: [join(directory, 'src/index.tsx')], bundle: true, outfile: join(directory, 'bundle.js'), jsx: 'automatic', loader: { '.png': 'file' }, assetNames: 'assets/[name]-[hash]',
  alias: { '@qitu/ui': join(root, 'packages/ui/src/index.tsx'), '@qitu/contracts': join(root, 'packages/contracts/src/index.ts') }, define: { 'process.env.NODE_ENV': '"development"' } });
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const port = Number(process.env.QITU_VISUAL_PREVIEW_PORT ?? 3219);
createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const path = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
  try { const data = await readFile(path); response.setHeader('content-type', contentTypes[extname(path)] ?? 'application/octet-stream'); response.end(data); }
  catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => process.stdout.write(`Visual fixture preview: http://127.0.0.1:${port}\nNo real API or student data is served.\n`));
