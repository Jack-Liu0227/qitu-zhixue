// Synthetic in-memory PostgreSQL only; no production connection is accepted.
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const req = createRequire(join(root, 'services/api/package.json'));
const external = createRequire(join(resolve(process.env.QITU_VERIFY_DEPENDENCY_ROOT), 'package.json'));
const entry = external.resolve('@electric-sql/pglite');
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === '@electric-sql/pglite' ? { url: pathToFileURL(entry).href, shortCircuit: true } : nextResolve(specifier, context);
} });
const runId = process.env.QITU_VERIFY_RUN_ID;
assert.match(runId, /^run-[0-9]+-[0-9]+$/);
delete process.env.QITU_VERIFY_DEPENDENCY_ROOT;
await import('./verify-workspace-source.mjs');
const { PGlite } = external('@electric-sql/pglite');
const { drizzle } = req('drizzle-orm/pglite');
const { PostgresProjectHistoryStore } = req(join(root, 'services/api/.tmp/pbl-capability', runId, 'dist/modules/projects/project-history.store.postgres.js'));
const pg = new PGlite();
try {
  await pg.exec(`
    CREATE TABLE projects (id text,student_user_id text,title text,subtitle text,tags jsonb DEFAULT '[]',status text,template_version_id text,current_stage_index int DEFAULT 0,stage_total int DEFAULT 4,progress_percent int DEFAULT 0,created_at timestamptz DEFAULT now());
    CREATE TABLE student_project_display (project_id text,student_user_id text,collected_at timestamptz);
    CREATE TABLE student_project_lists (student_user_id text,version int,current_project_id text);
    CREATE TABLE exploration_sessions (id text,student_user_id text,template_version_id text,status text DEFAULT 'exploring',created_at timestamptz DEFAULT now());
    CREATE TABLE intent_confirmations (exploration_id text,goal_user text,core_interests jsonb DEFAULT '[]');
    CREATE TABLE project_template_versions (id text,template_id text);
    CREATE TABLE project_templates (id text,title text);
    CREATE TABLE learning_plans (id text,student_user_id text,goal text,interest text,template_version_id text,status text,project_id text,created_at timestamptz DEFAULT now());
    CREATE TABLE tutor_sessions (id text,student_id text,exploration_id text);
    CREATE TABLE tutor_turns (session_id text,student_id text,role text);
    INSERT INTO projects(id,student_user_id,title,status) VALUES ('formal','owner','Confirmed project','intent_confirmed'),('finished','owner','Completed project','published'),('foreign','other','Other project','theory_learning');
    INSERT INTO exploration_sessions(id,student_user_id) VALUES ('empty','owner'),('opening','owner'),('answered','owner'),('intent','owner'),('foreign','other');
    INSERT INTO intent_confirmations VALUES ('intent','Investigate waves','[]');
    INSERT INTO tutor_sessions VALUES ('chat-opening','owner','opening'),('chat-answer','owner','answered'),('other-chat','other','empty');
    INSERT INTO tutor_turns VALUES ('chat-opening','owner','assistant'),('chat-answer','owner','student'),('other-chat','other','student');
    INSERT INTO learning_plans(id,student_user_id,goal,interest,status) VALUES ('pending','owner','Study plan','Optics','draft');
  `);
  const store = new PostgresProjectHistoryStore(drizzle(pg));
  const query = tab => store.query('owner', { tab, q: '', includeCollected: false, limit: 20 });
  assert.deepEqual((await query('active')).items.map(i => i.id), ['formal']);
  assert.deepEqual((await query('done')).items.map(i => i.id), ['finished']);
  const records = await query('draft');
  assert.deepEqual(records.items.map(i => i.id).sort(), ['answered','intent','pending']);
  assert.deepEqual(records.counts, { active: 1, done: 1, draft: 3 });
  await pg.exec("UPDATE exploration_sessions SET status='confirmed' WHERE id='answered'");
  assert.deepEqual((await query('draft')).items.map(i => i.id).sort(), ['intent','pending']);
  console.log('PASS: formal projects, nonempty exploration, opening-only suppression, student isolation and confirmation removal');
} finally { await pg.close(); }
