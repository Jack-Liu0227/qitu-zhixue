import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import './verify-workspace-source.mjs';

// Execute the actual browser data adapters and their node:test cases. App typechecking is a separate gate.
const require=createRequire(import.meta.url);
const root=resolve(import.meta.dirname,'..');
const cache=new Map();
function load(path){
  if(cache.has(path))return cache.get(path);
  const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','exports',code)(name=>{
    if(name.startsWith('node:'))return require(name);
    if(name==='@qitu/contracts')return require(name);
    if(name==='@qitu/api-client')return load(resolve(root,'packages/api-client/src/index.ts'));
    if(!name.startsWith('.'))throw new Error(`Unexpected browser data dependency: ${name}`);
    return load(resolve(dirname(path),name)+'.ts');
  },exports);
  return exports;
}
for(const test of ['features/projects/data/api-projects-data-source.test.ts','features/tutor/data/lessonWorkspaceApi.test.ts','features/tutor/data/tutor-confirmation.test.ts','features/tutor/data/tutor-exploration.test.ts','features/inspiration/data/inspiration-api-data-source.test.ts']){
  load(resolve(root,'apps/student-center',test));
}
