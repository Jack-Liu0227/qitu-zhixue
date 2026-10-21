import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiProjectsDataSource } from './api-projects-data-source';

test('project history sends search and pagination to the server and never loads the legacy full list', async () => {
  const original = globalThis.fetch;
  const calls:string[] = [];
  globalThis.fetch = async path => {
    calls.push(String(path));
    return Response.json({ data:{ items:[],nextCursor:'next',counts:{ active:200,draft:0,done:30 },revision:'revision',preferenceVersion:4 } });
  };
  try {
    const source = new ApiProjectsDataSource();
    const result = await source.queryProjects({ tab:'done',q:'Optics',cursor:'opaque-cursor',includeCollected:true });
    assert.equal(result.counts.active,200);
    const params = new URL(calls[0]!, 'http://fixture.invalid').searchParams;
    assert.equal(params.get('cursor'),'opaque-cursor');assert.equal(params.get('q'),'Optics');
    assert.equal(params.get('limit'),'12');assert.equal(params.get('includeCollected'),'true');
    assert.ok(calls.every(path => path.startsWith('/api/v1/projects/query?')));
  } finally { globalThis.fetch=original; }
});

test('display preference does not report success for an incomplete or mismatched readback',async()=>{
  const original=globalThis.fetch;
  let payload:unknown={};
  globalThis.fetch=async (_path,init)=>{
    assert.equal(new Headers(init?.headers).get('idempotency-key'),'stable-key');
    return Response.json({data:payload});
  };
  try {
    const source=new ApiProjectsDataSource();
    const request={expectedVersion:3,currentProjectId:'project'};
    const save=()=>source.changeProjectDisplay(null,request,'stable-key');
    await assert.rejects(save(),{code:'PROJECT_PREFERENCE_RECEIPT_INVALID'});
    payload={version:4,currentVersion:4,currentProjectId:'other',collectedAt:null,superseded:false,replayed:false};
    await assert.rejects(save(),{code:'PROJECT_PREFERENCE_RECEIPT_INVALID'});
    payload={version:4,currentVersion:4,currentProjectId:'project',collectedAt:null,superseded:false,replayed:true};
    assert.deepEqual(await save(),{superseded:false});
  } finally {globalThis.fetch=original;}
});

test('legacy task completion never advances a project or manufactures a receipt', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected network'); };
  try {
    await assert.rejects(new ApiProjectsDataSource().completeTask('session-fixture', 'key'),
      { code: 'SERVER_CONTRACT_REQUIRED' });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('project theory reads do not allocate pending questions or fall back to static optics', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}', { status: 403 }); };
  try {
    const source = new ApiProjectsDataSource();
    assert.deepEqual(await source.getTheoryQuestions('project-fixture'), []);
    assert.equal(calls, 0);
    await assert.rejects(source.getTheoryMaterial('project-fixture'), { status: 403 });
  } finally { globalThis.fetch = original; }
});
