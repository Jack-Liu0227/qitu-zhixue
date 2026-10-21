import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Disposable host for actual components. Browser tests supply isolated API responses.
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'services/api/.tmp/entry-history-browser');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'navigation.tsx'), `import {useSyncExternalStore} from 'react';
const subscribe=f=>{addEventListener('popstate',f);return()=>removeEventListener('popstate',f)};
const router={push:p=>location.assign(p.startsWith('/student')?p:'/student'+p),replace:p=>location.replace(p.startsWith('/student')?p:'/student'+p)};
export const useRouter=()=>router;
export function useSearchParams(){const search=useSyncExternalStore(subscribe,()=>location.search);return new URLSearchParams(search)}
export const usePathname=()=>location.pathname;`);
writeFileSync(join(out, 'link.tsx'), `export default function Link({href,children,...rest}){return <a href={href.startsWith('/')&&!href.startsWith('/student')?'/student'+href:href} {...rest}>{children}</a>}`);
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import ${JSON.stringify(join(root, 'packages/ui/src/styles.css'))};
import ${JSON.stringify(join(root, 'apps/student-center/styles/tutor.css'))};
import ${JSON.stringify(join(root, 'apps/student-center/styles/projects.css'))};
import {TutorPage} from ${JSON.stringify(join(root, 'apps/student-center/features/tutor/TutorPage.tsx'))};
import {ProjectListScreen} from ${JSON.stringify(join(root, 'apps/student-center/features/projects/components/ProjectListScreen.tsx'))};
import {FreeExplorePanel} from ${JSON.stringify(join(root, 'apps/student-center/features/inspiration/components/FreeExplorePanel.tsx'))};
import {RecommendedExplorationButton} from ${JSON.stringify(join(root, 'apps/student-center/features/inspiration/components/RecommendedExplorationButton.tsx'))};
import {TemplateTeamBindingPanel} from ${JSON.stringify(join(root, 'apps/admin-console/lib/components/TemplateTeamBindingPanel.tsx'))};
const path=location.pathname;
createRoot(document.getElementById('root')).render(path==='/student/projects'?<ProjectListScreen/>:
path==='/student/inspiration'?<><FreeExplorePanel/><RecommendedExplorationButton template={{id:'chosen',templateVersionId:'chosen-template',title:'选择的课程'}}/></>:
path==='/admin'?<TemplateTeamBindingPanel templateId="template" versionId="version" versionStatus="published" teams={[]} profiles={[]} phases={[]} requiresBundle/>:
<TutorPage projectId={path.endsWith('/legacy')?'legacy':undefined}/>);`;
await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', outfile: join(out, 'app.js'),
  alias: { 'next/navigation': join(out, 'navigation.tsx'), 'next/link': join(out, 'link.tsx'), '@qitu/ui': join(root, 'packages/ui/src/index.tsx'),
    '@qitu/contracts': join(root, 'packages/contracts/src/index.ts'), '@qitu/api-client': join(root, 'packages/api-client/src/index.ts') },
  define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'warning' });
const html = '<!doctype html><html lang="zh"><meta charset="utf-8"><title>Entry and history fixture</title><link rel="stylesheet" href="/app.css"><style>body{margin:20px}#root{min-height:90vh}button{cursor:pointer}</style><div id="root"></div><script type="module" src="/app.js"></script></html>';
createServer((req, res) => {
  if (req.url?.startsWith('/api/')) { res.writeHead(404); res.end('API fixture required'); return; }
  const asset = req.url === '/app.js' ? 'app.js' : req.url === '/app.css' ? 'app.css' : null;
  res.writeHead(200, { 'content-type': asset === 'app.js' ? 'text/javascript' : asset ? 'text/css' : 'text/html; charset=utf-8' });
  res.end(asset ? readFileSync(join(out, asset)) : html);
}).listen(3206, '127.0.0.1', () => console.log('Entry browser fixture http://127.0.0.1:3206'));
