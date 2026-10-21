import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Real PostgreSQL execution in an ephemeral WASM database, never a production connection.
const root = fileURLToPath(new URL('../',import.meta.url));
const dependencyRoot = process.env.QITU_VERIFY_DEPENDENCY_ROOT;
assert.ok(dependencyRoot,'Set QITU_VERIFY_DEPENDENCY_ROOT to the external verification dependencies');
const external = createRequire(join(dependencyRoot,'package.json'));
const pglitePath = external.resolve('@electric-sql/pglite');
registerHooks({ resolve(specifier,context,next) {
  return next(specifier === '@electric-sql/pglite' ? pglitePath : specifier,context);
} });
const { PGlite } = external('@electric-sql/pglite');
const apiRequire = createRequire(join(root,'services/api/package.json'));
const { drizzle } = apiRequire('drizzle-orm/pglite');
const report = JSON.parse(readFileSync(join(root,'services/api/.tmp/pbl-capability/verification.json'),'utf8'));
const run = process.env.QITU_VERIFY_RUN_ID ?? basename(report.runDirectory);
assert.match(run,/^run-\d+-\d+$/);
process.env.QITU_SOURCE_RUN_ID = run;
await import('./verify-workspace-source.mjs');
const apiSubdir=process.env.QITU_VERIFY_API_SUBDIR ?? 'dist';
assert.ok(['dist','supplement/dist'].includes(apiSubdir));
const compiled = relative => import(pathToFileURL(join(root,'services/api/.tmp/pbl-capability',run,apiSubdir,relative)).href);
const { PostgresProjectHistoryStore } = await compiled('modules/projects/project-history.store.postgres.js');
const { ProjectHistoryService } = await compiled('modules/projects/project-history.service.js');
const { PostgresLearningPlanStore } = await compiled('modules/learning-plan/learning-plan.store.postgres.js');
const { FakeIdempotencyStore,FakeAuditWriter,actor } = await compiled('modules/templates/templates.test-support.js');
const pg = new PGlite();
const checks = [];
try {
  await pg.exec(`CREATE TABLE users(id text PRIMARY KEY);
    CREATE TABLE projects(id text PRIMARY KEY,student_user_id text REFERENCES users(id),template_version_id text,source_exploration_id text,
      title text,subtitle text,tags jsonb DEFAULT '[]',status text,current_stage_index integer DEFAULT 1,
      stage_total integer DEFAULT 10,progress_percent integer DEFAULT 10,created_at timestamptz,completed_at timestamptz);
    CREATE TABLE exploration_sessions(id text PRIMARY KEY,student_user_id text,status text,template_version_id text,created_at timestamptz);
    CREATE TABLE intent_confirmations(exploration_id text,goal_user text);
    CREATE TABLE learning_plans(id text PRIMARY KEY,student_user_id text,status text,project_id text,template_version_id text,goal text,interest text,created_at timestamptz);`);
  const migration = readFileSync(join(root,'database/migrations/0046_project_display_preferences.sql'),'utf8');
  await pg.exec(migration);
  await pg.exec(`INSERT INTO users VALUES ('student'),('other');
    INSERT INTO projects(id,student_user_id,title,status,created_at)
      SELECT 'project-'||lpad(n::text,3,'0'),'student','Optics '||n,CASE WHEN n%3=0 THEN 'completed' ELSE 'theory_learning' END,'2026-10-01'::timestamptz + n*interval '1 hour' FROM generate_series(1,123) n;
    INSERT INTO projects(id,student_user_id,title,status,created_at) VALUES ('private','other','Private','theory_learning','2026-10-21');
    UPDATE projects SET created_at='2026-10-01 00:00:00.123456+00' WHERE id='project-001';
    UPDATE projects SET created_at='2026-10-01 00:00:00.123457+00' WHERE id='project-002';
    INSERT INTO exploration_sessions VALUES ('exploration','student','exploring',NULL,'2026-10-02');
    INSERT INTO intent_confirmations VALUES ('exploration','An actual unconfirmed exploration');
    INSERT INTO learning_plans VALUES ('draft-plan','student','draft',NULL,NULL,'A draft plan','Optics','2026-10-02');`);
  const db = drizzle(pg);
  const store = new PostgresProjectHistoryStore(db);
  const plans = new PostgresLearningPlanStore(db);
  const audit = new FakeAuditWriter();
  const service = new ProjectHistoryService(store,plans,new FakeIdempotencyStore(),audit);
  const student = actor('student','student');
  const first = await service.query(student,{ tab:'active',limit:'20' });
  assert.equal(first.items.length,20); assert.equal(first.counts.active,82); assert.equal(first.counts.done,41); assert.equal(first.counts.draft,2);
  assert.equal(first.selectionSource,'creation_fallback');assert.equal(first.items[0].id,'project-122');
  assert.ok(first.items.every(item => item.lastLearningActivityAt === null));
  const ids = new Set(first.items.map(item => item.id));
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await service.query(student,{ tab:'active',limit:'20',cursor });
    for (const item of page.items) { assert.ok(!ids.has(item.id));ids.add(item.id); } cursor=page.nextCursor;
  }
  assert.equal(ids.size,82);checks.push('bounded-keyset-pages-and-grouped-counts');
  const oneAtATime=new Set();let microCursor;
  do { const page=await service.query(student,{tab:'active',limit:'1',...(microCursor?{cursor:microCursor}:{})});
    for(const item of page.items){assert.ok(!oneAtATime.has(item.id));oneAtATime.add(item.id);}microCursor=page.nextCursor;
  } while(microCursor);
  assert.equal(oneAtATime.size,82);checks.push('microsecond-keyset-boundaries-without-skips');
  assert.equal((await service.query(student,{ tab:'all',q:'Private' })).items.length,0);
  assert.equal((await service.query(student,{ tab:'active',q:'Optics 122' })).items.length,1);
  assert.deepEqual(new Set((await service.query(student,{ tab:'draft' })).items.map(item => item.kind)),new Set(['plan','exploration']));
  assert.equal((await pg.query('SELECT count(*)::int n FROM projects')).rows[0].n,124);checks.push('authorized-search-and-drafts-without-project-creation');
  for (const raw of [{ limit:'51' },{ limit:'2e1' },{ includeCollected:['true'] },{ cursor:first.nextCursor.slice(0,-1)+'!' },{ cursor:first.nextCursor,tab:'done',limit:'20' }]) await assert.rejects(service.query(student,raw));
  await assert.rejects(service.query(actor('student','other'),{ tab:'active',limit:'20',cursor:first.nextCursor }));
  await assert.rejects(service.query(actor('parent','parent'),{}));checks.push('signed-student-filter-bound-cursors-and-input-validation');
  const selected = await service.change(student,null,{ expectedVersion:0,currentProjectId:'project-001' },'selection');
  assert.equal(selected.currentProjectId,'project-001');assert.equal(await service.currentSelection(student.id),'project-001');
  assert.equal((await service.change(student,null,{ expectedVersion:0,currentProjectId:'project-001' },'selection')).replayed,true);
  await assert.rejects(service.change(student,'project-001',{ expectedVersion:1,collected:true },'ambiguous-collect'));
  await assert.rejects(service.change(student,'private',{ expectedVersion:1,collected:true },'foreign'));
  await service.change(student,'project-001',{ expectedVersion:1,collected:true,currentProjectId:null },'collect');
  const secondDevice = new ProjectHistoryService(new PostgresProjectHistoryStore(db),plans,new FakeIdempotencyStore(),audit);
  assert.equal((await secondDevice.query(student,{ tab:'active',q:'Optics 1',limit:'50' })).items.some(item => item.id==='project-001'),false);
  assert.equal(await secondDevice.currentSelection(student.id),null);
  assert.ok((await secondDevice.query(student,{ tab:'active',q:'Optics 1',limit:'50',includeCollected:'true' })).items.find(item=>item.id==='project-001')?.collectedAt);
  await secondDevice.change(student,'project-001',{ expectedVersion:2,collected:false },'restore');
  assert.equal((await service.query(student,{ tab:'active',q:'Optics 1',limit:'50' })).items.find(item=>item.id==='project-001')?.collectedAt,null);
  checks.push('cross-device-collect-restore-and-explicit-selection');
  await assert.rejects(service.query(student,{ tab:'active',limit:'20',cursor:first.nextCursor }),error=>error.getResponse().code==='PROJECT_LIST_CHANGED');
  await assert.rejects(service.change(student,'project-002',{ expectedVersion:1,collected:true },'old-version'));
  const results=await Promise.allSettled(['project-004','project-005'].map((id,index)=>service.change(student,id,{ expectedVersion:3,collected:true },'race-'+index)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);checks.push('list-change-detection-and-concurrent-version-conflict');
  const failure=new ProjectHistoryService(store,plans,new FakeIdempotencyStore(),{write:async()=>{throw new Error('isolated audit failure');}});
  await assert.rejects(failure.change(student,null,{expectedVersion:4,currentProjectId:'project-002'},'audit-failure'));
  assert.equal((await service.query(student,{})).preferenceVersion,4);checks.push('audit-failure-rolls-back-preference-transaction');
  assert.ok((await pg.query("SELECT status FROM projects WHERE id='project-001'")).rows.every(row=>row.status==='theory_learning'));
  assert.ok(audit.entries.every(row=>row.action==='project.display.changed'));checks.push('display-only-without-learning-state-or-mastery-writes');
  await pg.exec(`INSERT INTO users VALUES ('initial-preferences');
    INSERT INTO projects(id,student_user_id,title,status,created_at) VALUES
      ('initial-older','initial-preferences','Older','theory_learning','2026-10-19'),
      ('initial-newer','initial-preferences','Newer','theory_learning','2026-10-20');`);
  const initial = actor('student','initial-preferences');
  assert.equal((await service.query(initial,{})).currentProjectId,'initial-newer');
  const collected = await service.change(initial,'initial-older',{expectedVersion:0,collected:true},'first-collection');
  assert.equal(collected.currentProjectId,'initial-newer');
  assert.equal(await service.currentSelection(initial.id),'initial-newer');
  assert.equal((await service.change(initial,'initial-older',{expectedVersion:0,collected:true},'first-collection')).replayed,true);
  await service.change(initial,'initial-older',{expectedVersion:1,collected:false},'first-restore');
  await service.change(initial,null,{expectedVersion:2,currentProjectId:null},'explicit-clear');
  await service.change(initial,'initial-older',{expectedVersion:3,collected:true},'after-clear');
  assert.equal(await service.currentSelection(initial.id),null);
  checks.push('first-collection-preserves-fallback-and-explicit-clear-remains-clear');
  await pg.exec(readFileSync(join(root,'database/migrations/0046_project_display_preferences.down.sql'),'utf8'));
  assert.equal((await pg.query('SELECT count(*)::int n FROM projects')).rows[0].n,126);checks.push('down-migration-preserves-projects');
  const receipt={ schemaVersion:1,engine:'PGlite PostgreSQL WASM',packageVersion:JSON.parse(readFileSync(join(pglitePath,'../../package.json'),'utf8')).version,
    sourceRunId:run,productionConnections:0,checks,success:true };
  writeFileSync(join(root,'services/api/.tmp/project-history-postgres-verification.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({ success:false,message:error.message,code:error.code,actual:error.actual,expected:error.expected,stack:error.stack?.split('\n').slice(0,4) }));
  process.exitCode=1;
} finally { await pg.close(); }
