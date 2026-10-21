import { createRequire } from 'node:module';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Component fixture only. All API requests must be supplied by the browser test.
const require=createRequire(import.meta.url);
const { build }=require('esbuild');
const root=fileURLToPath(new URL('../',import.meta.url));
const out=join(root,'services/api/.tmp/pbl-teaching-browser');mkdirSync(out,{recursive:true});
const port=Number(process.env.QITU_BROWSER_FIXTURE_PORT ?? 3205);
writeFileSync(join(out,'link.tsx'),`import React from 'react';export default function Link({href,children,...rest}){return <a href={typeof href==='string'?href:'#'} {...rest}>{children}</a>}`);
const entry=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {ProjectListScreen} from ${JSON.stringify(join(root,'apps/student-center/features/projects/components/ProjectListScreen.tsx'))};
import {StudentLessonQualityReviews} from ${JSON.stringify(join(root,'apps/teacher-workspace/components/student-lesson-quality-reviews.tsx'))};
import {LessonLearningWorkspace} from ${JSON.stringify(join(root,'apps/student-center/features/tutor/components/CurrentLessonCard.tsx'))};
import {TutorDataSourceProvider} from ${JSON.stringify(join(root,'apps/student-center/features/tutor/TutorDataSourceProvider.tsx'))};
function Lesson(){return <TutorDataSourceProvider><LessonLearningWorkspace projectId="project" lesson={{planId:'plan'}} onProgressChanged={async()=>{}}/></TutorDataSourceProvider>}
createRoot(document.getElementById('root')).render(location.pathname==='/teacher'?<StudentLessonQualityReviews studentId="student"/>:location.pathname==='/lesson'?<Lesson/>:<ProjectListScreen/>);
`;
await build({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,platform:'browser',format:'esm',jsx:'automatic',outfile:join(out,'app.js'),
  alias:{'next/link':join(out,'link.tsx'),'@qitu/ui':join(root,'packages/ui/src/index.tsx'),'@qitu/contracts':join(root,'packages/contracts/src/index.ts'),
    '@qitu/api-client':join(root,'packages/api-client/src/index.ts')},define:{'process.env.NODE_ENV':'"development"'},loader:{'.svg':'dataurl','.png':'dataurl'},logLevel:'warning'});
const html='<!doctype html><html lang="zh"><meta charset="utf-8"><title>PBL teaching component fixture</title><style>body{font:15px system-ui;margin:24px}button,input,select,textarea{padding:8px;margin:6px}textarea{display:block;width:90%}section,fieldset{margin:12px;padding:12px;border:1px solid #cbd5e1}pre{max-width:900px}.qitu-project-grid{grid-template-columns:repeat(3,minmax(0,1fr))}</style><div id="root"></div><script type="module" src="/app.js"></script></html>';
const server=createServer((request,response)=>{
  if(request.url?.startsWith('/api/')){response.writeHead(404);response.end('No fixture API response configured');return;}
  const asset=request.url==='/app.js'?'app.js':request.url==='/app.css'?'app.css':null;
  response.writeHead(200,{'content-type':asset?.endsWith('.js')?'text/javascript':asset?'text/css':'text/html; charset=utf-8'});
  response.end(asset?readFileSync(join(out,asset)):html);
});
server.listen(port,'127.0.0.1',()=>console.log(`Disposable component fixture: http://127.0.0.1:${port}`));
