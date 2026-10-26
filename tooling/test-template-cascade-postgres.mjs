import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Disposable in-process PostgreSQL only. This script never connects to DATABASE_URL.
const root = fileURLToPath(new URL('../', import.meta.url));
const external = createRequire(join(process.env.QITU_VERIFY_DEPENDENCY_ROOT, 'package.json'));
const pglitePath = external.resolve('@electric-sql/pglite');
registerHooks({ resolve(name, context, next) { return next(name === '@electric-sql/pglite' ? pglitePath : name, context); } });
const { PGlite } = external('@electric-sql/pglite');
const apiRequire = createRequire(join(root, 'services/api/package.json'));
const { drizzle } = apiRequire('drizzle-orm/pglite');
if (process.env.QITU_SOURCE_RUN_ID) await import('./verify-workspace-source.mjs');
const compiled = name => import(pathToFileURL(join(root, process.env.QITU_TEMPLATE_DELETE_DIST ?? 'services/api/dist', name)).href);
const { TemplateDeletionService } = await compiled('modules/templates/template-deletion.service.js');
const { AuditService } = await compiled('common/audit/audit.service.js');
const { IdempotencyService } = await compiled('common/idempotency/idempotency.service.js');
const pg = new PGlite();
const checks = [];
const admin = { id: 'admin', role: 'admin', email: '', displayName: 'Fixture admin' };
try {
  const journal = JSON.parse(readFileSync(join(root, 'database/migrations/meta/_journal.json'), 'utf8'));
  for (const entry of journal.entries) await pg.exec(readFileSync(join(root, 'database/migrations', `${entry.tag}.sql`), 'utf8'));
  checks.push('all-migrations');
  await pg.exec(`
    INSERT INTO users(id,email,display_name,role,password_hash) VALUES
      ('admin','a@example.test','Admin','admin','unused'),('student','s@example.test','Student','student','unused'),
      ('other','o@example.test','Other','student','unused'),('parent','p@example.test','Parent','parent','unused');
    INSERT INTO project_templates(id,slug,title,summary,status) VALUES
      ('course','fixture-course','Course','Fixture','archived'),('unrelated','fixture-unrelated','Other course','Fixture','published');
    INSERT INTO project_template_versions(id,template_id,version,status) VALUES
      ('version','course','v1','archived'),('other-version','unrelated','v1','published');
    INSERT INTO template_verification_runs(id,template_version_id,idempotency_key,evaluated_at) VALUES
      ('verification','version','verify',now()),('other-verification','other-version','other-verify',now());
    INSERT INTO template_verification_evidence(id,run_id,check_key,source_kind,source_id) VALUES
      ('ve','verification','fixture','project','project'),('ve-other-source','verification','fixture','project','private');
    INSERT INTO exploration_sessions(id,student_user_id,source,template_version_id,status) VALUES
      ('explore','student','recommended','version','confirmed');
    INSERT INTO intent_confirmations(id,exploration_id,goal_user) VALUES ('intent','explore','Fixture');
    INSERT INTO projects(id,student_user_id,template_version_id,source_exploration_id,status,stage_total,title) VALUES
      ('project','student','version','explore','intent_confirmed',4,'Fixture'),
      ('project-two','other','version',NULL,'intent_confirmed',4,'Fixture two'),
      ('private','student','other-version',NULL,'intent_confirmed',4,'Unrelated');
    INSERT INTO learning_plans(id,student_user_id,project_id,template_version_id,interest,goal,lesson_count,lesson_minutes,minutes_per_session,status,idempotency_key) VALUES
      ('plan','student','project','version','Fixture','Fixture',1,60,60,'active','plan'),
      ('draft','student',NULL,'version','Fixture','Fixture',1,60,60,'draft','draft'),
      ('private-plan','student','private','other-version','Fixture','Fixture',1,60,60,'active','private-plan');
    INSERT INTO tutor_partners(id,display_name,soul,prompt_version) VALUES ('partner','Fixture','Fixture','v1');
    INSERT INTO tutor_sessions(id,student_id,partner_id,project_id,exploration_id,source) VALUES
      ('session','student','partner','project',NULL,'project'),('explore-session','student','partner',NULL,'explore','exploration'),
      ('private-session','student','partner','private',NULL,'project');
    INSERT INTO tutor_turns(id,session_id,student_id,role,content,blocks,seq) VALUES
      ('turn','session','student','assistant','Disposable text','[]',1),
      ('explore-turn','explore-session','student','assistant','Disposable text','[]',1),
      ('private-turn','private-session','student','assistant','Unrelated text','[]',1);
    INSERT INTO answer_attempts(id,student_user_id,tutor_session_id,quiz_id,plan_id,concept_id,result,idempotency_key)
      VALUES ('answer','student','session','quiz','plan','concept','correct','answer');
    INSERT INTO artifacts(id,student_user_id,project_id,template_version_id,title,idempotency_key) VALUES
      ('artifact','student','project','version','Fixture','artifact'),('standalone-artifact','other',NULL,'version','Fixture','standalone'),
      ('private-artifact','student','private','other-version','Unrelated','private-artifact');
    INSERT INTO growth_records(id,student_user_id,project_id,type,occurred_at,title,summary_student,summary_parent,artifact_ref,idempotency_key)
      VALUES ('growth','student','project','artifact_published',now(),'Fixture','Fixture','Fixture','artifact','growth');
    INSERT INTO parent_growth_exports(id,parent_user_id,child_user_id,child_display_name,reason,status,expires_at,document) VALUES
      ('export','parent','student','Fixture','Fixture','ready',now()+interval '1 day','{"entries":[{"id":"growth","artifactRef":"artifact"}]}'),
      ('private-export','parent','student','Fixture','Fixture','ready',now()+interval '1 day','{"entries":[{"id":"unrelated-growth"}]}');
    INSERT INTO feedback_tickets(id,parent_user_id,child_user_id,source,project_id,status,problem)
      VALUES ('feedback','parent','student','project','project','open','Disposable fixture');
    INSERT INTO feedback_ticket_entries(id,ticket_id,seq,kind,author_role,author_id,author_display_name,content)
      VALUES ('entry','feedback',1,'submitted','parent','parent','Fixture','Disposable fixture');
    INSERT INTO agent_memory_records(id,student_id,partner_id,scope,kind,content,source_ref,source_event_id,metadata) VALUES
      ('memory','student','partner','student','learning','Disposable text','turn:turn','learning_interaction:turn','{"sessionId":"session","projectId":"project"}'),
      ('private-memory','student','partner','student','learning','Unrelated text','turn:private-turn','learning_interaction:private-turn','{"sessionId":"private-session","projectId":"private"}');
    INSERT INTO student_project_lists(student_user_id,current_project_id,version) VALUES ('student','project',3);
    INSERT INTO knowledge_bases(id,name,kind,project_id) VALUES ('kb','Fixture project knowledge','project','project');
    INSERT INTO project_knowledge_bindings(project_id,kb_id) VALUES ('project','kb');
    INSERT INTO knowledge_jobs(id,kb_id,operation,input_revision,state) VALUES ('job','kb','index',1,'completed');
    INSERT INTO agent_configs(id,display_name,role_definition) VALUES ('leader','Fixture','Fixture');
    INSERT INTO agent_team_runs(id,leader_agent_id,student_user_id,project_id,tutor_session_id,trigger,status,idempotency_key)
      VALUES ('run','leader','student','project','session','fixture','queued','run');
    INSERT INTO agent_mailboxes(agent_id,pending_count) VALUES ('leader',1);
    INSERT INTO agent_team_messages(id,run_id,mailbox_agent_id,sender_agent_id,recipient_agent_id,message_type,payload,idempotency_key)
      VALUES ('message','run','leader','leader','leader','fixture','{}','message');
    INSERT INTO idempotency_keys(id,scope,key,request_hash,status,response_body,expires_at) VALUES
      ('cached','fixture','cached','hash','succeeded','{"data":{"planId":"plan","text":"Disposable"}}',now()+interval '1 day'),
      ('private-cache','fixture','private','hash','succeeded','{"data":{"planId":"private-plan"}}',now()+interval '1 day');
    INSERT INTO outbox(id,topic,payload,status) VALUES ('event','fixture','{"nested":{"artifactId":"artifact"}}','pending');
    INSERT INTO mastery_events(id,student_user_id,knowledge_point_id,course_version,plan_id,project_id,event_type,knowledge_type,valid_from,sequence,source_type,source_event_id,assessment_version,idempotency_key)
      VALUES ('mastery','student','concept','v1','plan','project','attempt','concept',now(),1,'answer','answer','v1','mastery');
    INSERT INTO mastery_graph_receipts(event_id,payload_hash) VALUES ('mastery','fixture');
  `);
  await pg.exec(`
    INSERT INTO learning_modules(id,plan_id,name,lesson_index,ordinal) VALUES ('module','plan','Fixture',1,1);
    INSERT INTO learning_objectives(id,plan_id,module_id,name,type,objective,ordinal) VALUES ('objective','plan','module','Fixture','concept','Fixture',1);
    INSERT INTO learning_sessions(id,plan_id,module_id,index,lesson_index) VALUES ('lesson','plan','module',1,1);
    UPDATE mastery_events SET objective_id='objective' WHERE id='mastery';
    UPDATE answer_attempts SET objective_id='objective' WHERE id='answer';
    INSERT INTO artifact_versions(id,artifact_id,ordinal,title,note) VALUES ('artifact-version','artifact',1,'Fixture','Disposable content');
    INSERT INTO pbl_template_team_bindings(id,template_version_id,team_version_id,binding_hash,team_snapshots)
      VALUES ('binding','version','frozen-config','fixture','{"frozen-config":{}}');
    INSERT INTO project_binding_snapshots(project_id,template_version_id,binding_id,team_version_id,binding_hash,bound_at)
      VALUES ('project','version','binding','frozen-config','fixture',now());
    INSERT INTO growth_records(id,student_user_id,type,occurred_at,title,summary_student,summary_parent,artifact_ref,idempotency_key)
      VALUES ('standalone-growth','other','artifact_published',now(),'Fixture','Fixture','Fixture','standalone-artifact','standalone-growth');
    INSERT INTO outbox(id,topic,payload,status) VALUES ('mastery-outbox','mastery.fixture','{"eventId":"mastery"}','pending');
  `);
  const db = drizzle(pg), audit = new AuditService(db), idem = new IdempotencyService(db);
  const service = new TemplateDeletionService(db, audit, idem);
  const count = async (table, where = '') => Number((await pg.query(`SELECT count(*)::int n FROM ${table} ${where}`)).rows[0].n);
  const confirmation = impact => ({ includeLearningData: true, expectedFingerprint: impact.fingerprint, confirmedTitle: impact.title });
  const rejectsCode = (promise, code) => assert.rejects(promise, error => error.getResponse?.().code === code);
  for (const role of ['student','teacher','parent']) {
    await assert.rejects(service.preview({ ...admin, role }, 'course'), error => error.getStatus?.() === 403);
    await assert.rejects(service.remove({ ...admin, role }, 'course', {}, 'key'), error => error.getStatus?.() === 403);
  }
  await rejectsCode(service.remove(admin,'course',{},'key'), 'TEMPLATE_DELETE_CONFIRMATION_REQUIRED');
  await rejectsCode(service.preview(admin,'unrelated'), 'TEMPLATE_DELETE_PROTECTED');
  let impact = await service.preview(admin,'course');
  assert.equal(impact.counts.students,2); assert.equal(impact.counts.projects,2);
  assert.equal(impact.counts.verification,1); assert.equal(impact.counts.verificationEvidence,2);
  assert.equal(JSON.stringify(impact).includes('Disposable'),false);
  await rejectsCode(service.remove(admin,'course',{...confirmation(impact),confirmedTitle:'Wrong'},'wrong'), 'TEMPLATE_DELETE_STALE');
  await pg.exec(`INSERT INTO template_verification_runs(id,template_version_id,idempotency_key,evaluated_at) VALUES ('verification-new','version','new-verify',now())`);
  await rejectsCode(service.remove(admin,'course',confirmation(impact),'stale'), 'TEMPLATE_DELETE_STALE');
  assert.equal(await count('projects'),3);
  checks.push('admin-permissions-explicit-confirmation-impact-and-stale-scope');
  impact = await service.preview(admin,'course');
  await pg.exec("UPDATE agent_team_runs SET lease_expires_at=now()+interval '1 hour' WHERE id='run'");
  const busy = await service.preview(admin,'course');
  await rejectsCode(service.remove(admin,'course',confirmation(busy),'busy'), 'TEMPLATE_DELETE_BUSY');
  await pg.exec("UPDATE agent_team_runs SET lease_expires_at=NULL WHERE id='run'; UPDATE knowledge_jobs SET state='running' WHERE id='job'");
  await rejectsCode(service.remove(admin,'course',confirmation(impact),'kb-busy'), 'HISTORY_DELETE_BUSY');
  assert.equal(await count('tutor_turns'),3); assert.equal(await count('template_verification_runs'),3);
  await pg.exec("UPDATE knowledge_jobs SET state='completed' WHERE id='job'; UPDATE project_knowledge_bindings SET project_id='private' WHERE kb_id='kb'");
  await rejectsCode(service.remove(admin,'course',confirmation(impact),'shared'), 'PROJECT_DELETE_SHARED_KNOWLEDGE');
  await pg.exec("UPDATE project_knowledge_bindings SET project_id='project' WHERE kb_id='kb'");
  const failing = new TemplateDeletionService(db,{write:async()=>{throw new Error('fixture audit failure');}},idem);
  await assert.rejects(failing.remove(admin,'course',confirmation(impact),'audit-failure'),/fixture audit failure/);
  for (const table of ['template_verification_evidence','projects','tutor_turns','artifacts','knowledge_bases','agent_memory_records']) assert.ok(await count(table)>0,table);
  assert.equal((await pg.query("SELECT content FROM agent_memory_records WHERE id='memory'")).rows[0].content,'Disposable text');
  checks.push('busy-workers-shared-knowledge-and-audit-failure-roll-back-all-data');
  const removed = await service.remove(admin,'course',confirmation(impact),'remove');
  assert.equal(removed.success,true);
  assert.deepEqual(await service.remove(admin,'course',confirmation(impact),'remove'),removed);
  for (const table of ['template_verification_evidence','exploration_sessions','intent_confirmations','answer_attempts','growth_records',
    'feedback_tickets','feedback_ticket_entries','knowledge_bases','knowledge_jobs','project_knowledge_bindings','mastery_events','mastery_graph_receipts',
    'agent_team_runs','agent_team_messages','learning_modules','learning_objectives','learning_sessions','artifact_versions',
    'pbl_template_team_bindings','project_binding_snapshots']) assert.equal(await count(table),0,table);
  for (const table of ['project_templates','project_template_versions','template_verification_runs','projects','learning_plans','artifacts','tutor_sessions','tutor_turns']) {
    assert.equal(await count(table),1,table);
  }
  assert.equal((await pg.query("SELECT current_project_id FROM student_project_lists WHERE student_user_id='student'")).rows[0].current_project_id,null);
  assert.equal((await pg.query("SELECT pending_count FROM agent_mailboxes WHERE agent_id='leader'")).rows[0].pending_count,0);
  assert.equal(await count('idempotency_keys',"WHERE id='cached'"),0);
  assert.equal(await count('idempotency_keys',"WHERE id='private-cache'"),1);
  assert.equal(await count('outbox',"WHERE id='event'"),0);
  assert.equal(await count('outbox',"WHERE id='mastery-outbox'"),0);
  assert.equal(await count('outbox',"WHERE topic='agent-memory.index' AND payload->>'memoryId'='memory'"),1);
  assert.equal((await pg.query("SELECT status,content FROM agent_memory_records WHERE id='memory'")).rows[0].status,'deleted');
  assert.equal((await pg.query("SELECT status,content FROM agent_memory_records WHERE id='memory'")).rows[0].content,'');
  assert.equal((await pg.query("SELECT content FROM agent_memory_records WHERE id='private-memory'")).rows[0].content,'Unrelated text');
  assert.equal((await pg.query("SELECT document FROM parent_growth_exports WHERE id='export'")).rows[0].document,null);
  assert.equal((await pg.query("SELECT status FROM parent_growth_exports WHERE id='private-export'")).rows[0].status,'ready');
  assert.equal(await count('audit_logs',"WHERE action='template.delete'"),1);
  assert.equal(await count('users'),4);
  checks.push('complete-two-student-cascade-replay-single-audit-unrelated-course-and-identities-preserved');
  await pg.exec("INSERT INTO project_templates(id,slug,title,summary,status) VALUES ('empty','empty','Empty','Fixture','draft')");
  const empty = await service.preview(admin,'empty');
  assert.equal(empty.counts.projects,0);
  assert.equal((await service.remove(admin,'empty',confirmation(empty),'empty')).success,true);
  checks.push('empty-course-without-versions');
  console.log(JSON.stringify({success:true,checks},null,2));
} catch (error) {
  console.error(JSON.stringify({checks, error: error.message, code: error.code,
    cause: error.cause?.message, detail: error.detail, stack: error.stack?.split('\n').slice(0,5)}, null, 2));
  process.exitCode = 1;
} finally { await pg.close(); }
