import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// All fixture data lives in a disposable PostgreSQL engine. Never accepts DATABASE_URL.
const root = fileURLToPath(new URL('../', import.meta.url));
const external = createRequire(join(process.env.QITU_VERIFY_DEPENDENCY_ROOT, 'package.json'));
const pglitePath = external.resolve('@electric-sql/pglite');
registerHooks({ resolve(specifier, context, next) { return next(specifier === '@electric-sql/pglite' ? pglitePath : specifier, context); } });
const { PGlite } = external('@electric-sql/pglite');
const apiRequire = createRequire(join(root, 'services/api/package.json'));
const { drizzle } = apiRequire('drizzle-orm/pglite');
const report = JSON.parse(readFileSync(join(root, 'services/api/.tmp/pbl-capability/verification.json'), 'utf8'));
const run = process.env.QITU_VERIFY_RUN_ID ?? basename(report.runDirectory.replaceAll('\\', '/'));
process.env.QITU_SOURCE_RUN_ID = run;
await import('./verify-workspace-source.mjs');
const compiled = relative => import(pathToFileURL(join(root, 'services/api/.tmp/pbl-capability', run, 'dist', relative)).href);
const { StudentHistoryCleanupService } = await compiled('modules/projects/student-history-cleanup.service.js');
const { PostgresProjectHistoryStore } = await compiled('modules/projects/project-history.store.postgres.js');
const { ProjectCoversService } = await compiled('modules/projects/project-covers.service.js');
const { PostgresTutorSessionStore } = await compiled('modules/ai-tutor/tutor-session.store.postgres.js');
const { AuditService } = await compiled('common/audit/audit.service.js');
const { IdempotencyService } = await compiled('common/idempotency/idempotency.service.js');
const { ProjectTeachingPlanRecoveryService } = await compiled('modules/projects/project-teaching-plan-recovery.service.js');
const { LearningPlanService } = await compiled('modules/learning-plan/learning-plan.service.js');
const { PostgresLearningPlanStore } = await compiled('modules/learning-plan/learning-plan.store.postgres.js');
const { DeterministicPlanGenerator } = await compiled('modules/learning-plan/plan-generator.js');
const { configurationBindingFixture } = await compiled('modules/templates/configuration-binding.test-fixture.js');
const pg = new PGlite();
const checks = [];
const student = { id: 'student', role: 'student', email: '', displayName: '' };
try {
  const journal = JSON.parse(readFileSync(join(root, 'database/migrations/meta/_journal.json'), 'utf8'));
  for (const entry of journal.entries) {
    try { await pg.exec(readFileSync(join(root, 'database/migrations', `${entry.tag}.sql`), 'utf8')); }
    catch (error) { throw new Error(`Fixture migration ${entry.tag}: ${error.message}`, { cause: error }); }
  }
  checks.push('all-reviewed-migrations-including-project-scoped-gates');
  await pg.exec(`INSERT INTO users(id,email,display_name,role,password_hash) VALUES
    ('student','fixture-student@example.test','Fixture','student','unused'),('other','fixture-other@example.test','Other','student','unused');
    INSERT INTO tutor_partners(id,display_name,soul,prompt_version) VALUES ('partner','Fixture partner','Fixture','v1');
    INSERT INTO exploration_sessions(id,student_user_id,source,status) VALUES ('explore','student','free','exploring'),('source','student','free','confirmed');
    INSERT INTO projects(id,student_user_id,source_exploration_id,status,stage_total,title) VALUES
    ('project','student','source','intent_confirmed',4,'Fixture optics'),('private','other',NULL,'intent_confirmed',4,'Other project');
    INSERT INTO learning_plans(id,student_user_id,project_id,interest,goal,lesson_count,lesson_minutes,minutes_per_session,status,idempotency_key) VALUES
    ('plan','student','project','Optics','Fixture goal',16,60,60,'active','plan'),('draft','student',NULL,'Art','Draft',1,60,60,'draft','draft');
    INSERT INTO tutor_sessions(id,student_id,partner_id,project_id,exploration_id,source) VALUES
    ('session','student','partner','project',NULL,'project'),('explore-session','student','partner',NULL,'explore','exploration'),
    ('private-session','other','partner','private',NULL,'project'),
    ('source-session','student','partner',NULL,'source','exploration');
    INSERT INTO intent_confirmations(id,exploration_id,goal_user) VALUES ('source-intent','source','Confirmed project intent');
    INSERT INTO tutor_turns(id,session_id,student_id,role,content,blocks,seq) VALUES
    ('turn','session','student','assistant','Fixture text','[]',1),('explore-turn','explore-session','student','assistant','Draft text','[]',1),
    ('other-turn','private-session','other','assistant','Private text','[]',1),
    ('source-turn','source-session','student','assistant','Pre-confirmation text','[]',1);
    INSERT INTO answer_attempts(id,student_user_id,tutor_session_id,quiz_id,plan_id,concept_id,result,idempotency_key)
    VALUES ('answer','student','session','quiz','plan','concept','correct','answer');
    INSERT INTO student_project_lists(student_user_id,current_project_id,version) VALUES ('student','project',3);
    INSERT INTO idempotency_keys(id,scope,key,request_hash,status,response_body,expires_at)
    VALUES ('cached','tutor.turn:session','turn','hash','succeeded','{"events":["Fixture text"]}',now()+interval '1 day');
    INSERT INTO agent_configs(id,display_name,role_definition) VALUES ('fixture-leader','Fixture','Fixture');
    INSERT INTO agent_team_runs(id,leader_agent_id,student_user_id,project_id,tutor_session_id,trigger,status,idempotency_key)
      VALUES ('queued-run','fixture-leader','student','project','session','fixture','queued','queued-run');
    INSERT INTO agent_mailboxes(agent_id,pending_count) VALUES ('fixture-leader',1);
    INSERT INTO agent_team_messages(id,run_id,mailbox_agent_id,sender_agent_id,recipient_agent_id,message_type,payload,idempotency_key)
      VALUES ('queued-message','queued-run','fixture-leader','fixture-leader','fixture-leader','fixture','{}','queued-message');`);
  const db = drizzle(pg);
  const service = new StudentHistoryCleanupService(db, new AuditService(db), new IdempotencyService(db));
  const tutorStore = new PostgresTutorSessionStore(db);
  const count = async (table, where = '') => Number((await pg.query(`SELECT count(*)::int n FROM ${table} ${where}`)).rows[0].n);
  await assert.rejects(service.remove({ ...student, role: 'parent' }, 'project', 'project', 'role'), /只能删除/);
  await assert.rejects(service.remove(student, 'project', 'private', 'foreign'), /记录不存在或无权删除/);
  await assert.rejects(service.remove(student, 'unknown', 'project', 'unknown'));
  await assert.rejects(service.remove(student, 'project', 'project', ''));
  checks.push('role-object-ownership-and-boundary-validation');
  const history = await service.conversations(student);
  assert.equal(history.length, 2); assert.ok(history.every(item => item.id !== 'private'));
  assert.equal(history.filter(item => item.id === 'project').length, 1);
  assert.equal(history.some(item => item.id === 'source'), false);
  assert.equal(history.find(item => item.id === 'project').includesExploration, true);
  assert.equal(history.find(item => item.id === 'project').turnCount, 2);
  checks.push('exact-source-FK-groups-exploration-and-formal-project-chat');
  await pg.exec(`INSERT INTO project_templates(id,slug,title,summary,status) VALUES ('history-template','history-title','Template exploration title','Fixture','published');
    INSERT INTO project_template_versions(id,template_id,version,status) VALUES ('history-version','history-template','v1','published');
    INSERT INTO exploration_sessions(id,student_user_id,source,template_version_id,status) VALUES
      ('template-explore','student','recommended','history-version','exploring'),
      ('closed-template-explore','student','recommended','history-version','closed');
    INSERT INTO intent_confirmations(id,exploration_id,goal_user) VALUES ('history-intent','template-explore','A different draft goal');
    INSERT INTO tutor_sessions(id,student_id,partner_id,exploration_id,source) VALUES
      ('template-session','student','partner','template-explore','exploration'),
      ('closed-template-session','student','partner','closed-template-explore','exploration');`);
  const historyStore = new PostgresProjectHistoryStore(db);
  const draftQuery = { tab:'draft', q:'Template exploration title', includeCollected:false, limit:20 };
  assert.equal((await service.conversations(student)).find(item => item.id === 'template-explore').title,'Template exploration title');
  assert.equal((await service.conversations(student)).find(item => item.id === 'closed-template-explore').title,'Template exploration title');
  assert.equal((await historyStore.query('student',draftQuery)).items[0].title,'Template exploration title');
  assert.equal((await service.conversations(student)).find(item => item.id === 'explore').title,'自由探索');
  await pg.exec("UPDATE project_templates SET title='Updated template title' WHERE id='history-template'");
  assert.equal((await service.conversations(student)).find(item => item.id === 'template-explore').title,'Updated template title');
  assert.equal((await historyStore.query('student',{...draftQuery,q:'Updated template title'})).items[0].title,'Updated template title');
  await service.remove(student,'exploration','template-explore','template-history-delete');
  await service.remove(student,'exploration','closed-template-explore','closed-template-history-delete');
  assert.equal(await count('tutor_sessions',"WHERE id IN ('template-session','closed-template-session')"),0);
  checks.push('template-history-names-follow-exact-version-and-owner-can-delete-closed-exploration');
  const first = await service.remove(student, 'conversation', 'project', 'chat-delete');
  assert.equal(first.deleted, true); assert.equal((await service.remove(student, 'conversation', 'project', 'chat-delete')).replayed, true);
  assert.equal(await count('tutor_sessions', "WHERE id='session'"), 0);
  assert.equal(await count('tutor_turns', "WHERE id='turn'"), 0);
  assert.equal(await count('tutor_sessions', "WHERE id='source-session'"), 0);
  assert.equal(await count('tutor_turns', "WHERE id='source-turn'"), 0);
  assert.equal(await count('intent_confirmations', "WHERE id='source-intent'"), 1);
  assert.equal(await count('exploration_sessions', "WHERE id='source'"), 1);
  assert.equal(await count('idempotency_keys', "WHERE id='cached'"), 0);
  assert.equal(await count('agent_team_runs', "WHERE id='queued-run'"), 0);
  assert.equal((await pg.query("SELECT pending_count FROM agent_mailboxes WHERE agent_id='fixture-leader'")).rows[0].pending_count,0);
  assert.equal((await pg.query("SELECT tutor_session_id FROM answer_attempts WHERE id='answer'")).rows[0].tutor_session_id, null);
  assert.equal(await count('learning_plans', "WHERE id='plan'"), 1);
  assert.equal(await count('projects', "WHERE id='project' AND status='intent_confirmed'"), 1);
  assert.equal((await service.conversations(student)).some(item => item.id === 'project'), false);
  const newSessionId = await tutorStore.projectSessionId('project');
  assert.equal(newSessionId, 'session-project:generation:1');
  await assert.rejects(tutorStore.create({ sessionId: 'session-project', ownerId:'student', partnerId:'partner', projectId:'project', source:'project', createdAt:new Date().toISOString() }));
  await tutorStore.create({ sessionId:newSessionId, ownerId:'student', partnerId:'partner', projectId:'project', source:'project', createdAt:new Date().toISOString() });
  assert.equal((await tutorStore.findByProject('project')).turns.length, 0);
  await assert.rejects(tutorStore.appendTurns({ sessionId:'session', expectedLastSeq:0, newLastSeq:1, turns:[] }));
  checks.push('conversation-hard-delete-idempotency-history-and-preserved-grading');
  await service.remove(student, 'exploration', 'explore', 'explore-delete');
  assert.equal(await count('exploration_sessions', "WHERE id='explore'"), 0);
  assert.equal(await count('tutor_turns', "WHERE id='explore-turn'"), 0);
  await assert.rejects(service.remove(student, 'exploration', 'source', 'confirmed-explore'));
  await service.remove(student, 'plan', 'draft', 'draft-delete');
  assert.equal(await count('learning_plans', "WHERE id='draft'"), 0);
  await assert.rejects(service.remove(student, 'plan', 'plan', 'active-plan-delete'));
  checks.push('exploration-and-plan-permanent-delete-confirmed-roots-protected');
  const covers = new ProjectCoversService(db, { presentationSnapshot: async () => [] });
  const themed = await covers.decorate(['Optics lens','Python game','小车动能','Creative'].map(title => ({ title, subtitle:'', tags:[], templateVersionId:'unknown' })));
  assert.deepEqual(themed.map(item => item.coverAssetId), ['cover-optics-v1','cover-coding-v1','cover-kinetic-v1','artifact-integrated-v1']);
  checks.push('relevant-registered-cover-assets');
  await pg.exec(`INSERT INTO knowledge_bases(id,name,kind,project_id) VALUES ('kb','Project fixture','project','project');
    INSERT INTO project_knowledge_bindings(project_id,kb_id) VALUES ('project','kb');
    INSERT INTO knowledge_jobs(id,kb_id,operation,input_revision,state) VALUES ('job','kb','index',1,'running');`);
  await assert.rejects(service.remove(student, 'project', 'project', 'busy-delete'));
  assert.equal(await count('projects', "WHERE id='project'"), 1);
  await pg.exec("UPDATE knowledge_jobs SET state='completed' WHERE id='job'");
  // An audit failure must roll back every destructive statement.
  const failing = new StudentHistoryCleanupService(db, { write: async () => { throw new Error('fixture audit failure'); } }, new IdempotencyService(db));
  await assert.rejects(failing.remove(student, 'project', 'project', 'rollback-delete'), /fixture audit failure/);
  assert.equal(await count('projects', "WHERE id='project'"), 1);
  assert.equal(await count('learning_plans', "WHERE id='plan'"), 1);
  assert.equal(await count('knowledge_bases', "WHERE id='kb'"), 1);
  checks.push('busy-worker-and-transactional-audit-rollback');
  await service.remove(student, 'project', 'project', 'project-delete');
  assert.equal(await count('projects', "WHERE id='project'"), 0);
  assert.equal(await count('exploration_sessions', "WHERE id='source'"), 0);
  assert.equal(await count('learning_plans', "WHERE id='plan'"), 0);
  assert.equal(await count('answer_attempts', "WHERE id='answer'"), 0);
  assert.equal(await count('knowledge_bases', "WHERE id='kb'"), 0);
  assert.equal(await count('projects', "WHERE id='private'"), 1);
  assert.equal(await count('tutor_turns', "WHERE id='other-turn'"), 1);
  assert.equal((await pg.query("SELECT current_project_id FROM student_project_lists WHERE student_user_id='student'")).rows[0].current_project_id, null);
  assert.equal((await service.remove(student, 'project', 'project', 'project-delete')).replayed, true);
  assert.equal(await count('audit_logs', "WHERE action='student.history.permanently_deleted'"), 6);
  checks.push('project-plan-knowledge-evidence-source-preference-cleanup-and-foreign-isolation');
  const fixture = await configurationBindingFixture();
  await fixture.activate();
  const frozen = (await fixture.store.findBinding(fixture.binding.id)).bundlePayload;
  await pg.exec(`INSERT INTO project_templates(id,slug,title,summary,status) VALUES ('configuration-template','fixture-recovery','Fixture','Fixture','published');
    INSERT INTO project_template_versions(id,template_id,version,status) VALUES ('configuration-version','configuration-template','v1','published');
    INSERT INTO projects(id,student_user_id,template_version_id,status,stage_total,title) VALUES
    ('recover-project','student','configuration-version','intent_confirmed',4,'Fixture recovery');`);
  const planStore = new PostgresLearningPlanStore(db);
  const audit = new AuditService(db);
  const idempotency = new IdempotencyService(db);
  const bindings = { getFrozenTeachingBundle: async () => frozen };
  const plans = new LearningPlanService(planStore, new DeterministicPlanGenerator(), idempotency, audit, {}, {}, undefined, undefined, bindings);
  const recovery = new ProjectTeachingPlanRecoveryService(db, planStore, plans, bindings, audit, idempotency);
  await assert.rejects(recovery.recover({ ...student, id:'other' }, 'recover-project', 'foreign-recovery'));
  const recovered = await recovery.recover(student, 'recover-project', 'recover-plan');
  assert.equal(recovered.recovered, true);
  assert.equal((await recovery.recover(student, 'recover-project', 'recover-plan')).replayed, true);
  assert.equal((await recovery.recover(student, 'recover-project', 'recover-readback')).planId, recovered.planId);
  assert.equal(await count('learning_plans', "WHERE project_id='recover-project'"), 1);
  assert.equal(await count('learning_sessions', `WHERE plan_id='${recovered.planId}'`), 16);
  assert.equal(await count('mastery_events'), 0);
  assert.equal(await count('learning_session_progress'), 0);
  assert.equal((await pg.query("SELECT status FROM projects WHERE id='recover-project'")).rows[0].status, 'intent_confirmed');
  checks.push('frozen-plan-owner-recovery-is-idempotent-and-creates-no-completion-facts');
  const result = { success:true, disposableFixture:true, checks };
  writeFileSync(join(root, 'services/api/.tmp/student-history-cleanup-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await pg.close(); }
