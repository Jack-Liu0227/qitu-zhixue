import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// An ephemeral PostgreSQL WASM instance; never uses DATABASE_URL or production data.
const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.env.QITU_VERIFY_DEPENDENCY_ROOT, 'Set QITU_VERIFY_DEPENDENCY_ROOT to verification dependencies');
const external = createRequire(join(process.env.QITU_VERIFY_DEPENDENCY_ROOT, 'package.json'));
const { PGlite } = external('@electric-sql/pglite');
const pg = new PGlite();
const migration = readFileSync(join(root, 'database/migrations/0053_resource_name_uniqueness.sql'), 'utf8');
const down = readFileSync(join(root, 'database/migrations/0053_resource_name_uniqueness.down.sql'), 'utf8');
let checks = 0;
async function conflict(query, params, constraint) {
  await assert.rejects(pg.query(query, params), error => error.code === '23505' && error.constraint === constraint);
  checks++;
}
try {
  await pg.exec(`
    CREATE TABLE admin_assistants(id text PRIMARY KEY, name text, enabled boolean DEFAULT true);
    CREATE TABLE admin_teams(id text PRIMARY KEY, name text, enabled boolean DEFAULT true);
    CREATE TABLE agent_configs(id text PRIMARY KEY, display_name text);
    CREATE TABLE project_templates(id text PRIMARY KEY, school_id text, title text, status text DEFAULT 'draft');
    CREATE TABLE knowledge_bases(id text PRIMARY KEY, school_id text, owner_user_id text, project_id text, name text, lifecycle text DEFAULT 'active');
    CREATE TABLE model_providers(id text PRIMARY KEY, name text);
    CREATE TABLE model_models(provider_id text, model_id text, display_name text, PRIMARY KEY(provider_id,model_id));
    CREATE TABLE runtime_mcp_servers(id text PRIMARY KEY, label text);
  `);
  await pg.exec(migration);
  const whitespaces = [9, 10, 11, 12, 13, 32, 160, 5760, ...Array.from({ length: 11 }, (_, i) => 8192 + i), 8232, 8233, 8239, 8287, 12288, 65279];
  for (const code of whitespaces) {
    const space = String.fromCodePoint(code);
    const { rows } = await pg.query('SELECT qitu_resource_name_key($1) AS key', [`${space}Optics${space}${space}Lab${space}`]);
    assert.equal(rows[0].key, 'optics lab'); checks++;
  }
  for (const [table, field, constraint] of [
    ['admin_assistants', 'name', 'admin_assistants_name_unique_idx'],
    ['admin_teams', 'name', 'admin_teams_name_unique_idx'],
    ['agent_configs', 'display_name', 'agent_configs_name_unique_idx'],
    ['model_providers', 'name', 'model_providers_name_unique_idx'],
    ['runtime_mcp_servers', 'label', 'runtime_mcp_servers_name_unique_idx'],
  ]) {
    await pg.query(`INSERT INTO ${table}(id,${field}) VALUES ('first','Optics Lab'),('other','Other')`);
    await conflict(`INSERT INTO ${table}(id,${field}) VALUES ('copy',$1)`, [' OPTICS\tLAB '], constraint);
    await conflict(`UPDATE ${table} SET ${field}=$1 WHERE id='other'`, ['optics lab'], constraint);
    await pg.query(`UPDATE ${table} SET ${field}='OPTICS LAB' WHERE id='first'`);
    const race = await Promise.allSettled(['race-one', 'race-two'].map(id => pg.query(
      `INSERT INTO ${table}(id,${field}) VALUES ($1,'Concurrent')`, [id],
    )));
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(race.find(result => result.status === 'rejected').reason.constraint, constraint);
    checks++;
  }
  await pg.exec("UPDATE admin_teams SET enabled=false WHERE id='first'");
  await conflict("INSERT INTO admin_teams VALUES ('disabled-copy','Optics Lab',true)", [], 'admin_teams_name_unique_idx');
  await pg.exec("INSERT INTO project_templates(id,title,status) VALUES ('global','Optics','archived')");
  await conflict("INSERT INTO project_templates(id,title) VALUES ('duplicate',' optics ')", [], 'project_templates_platform_name_unique_idx');
  await pg.exec("INSERT INTO project_templates(id,school_id,title) VALUES ('school-a','a','Optics'),('school-b','b','Optics')");
  await conflict("INSERT INTO project_templates(id,school_id,title) VALUES ('same-school','a','OPTICS')", [], 'project_templates_school_name_unique_idx');
  await pg.exec("INSERT INTO knowledge_bases(id,name) VALUES ('global','Optics')");
  await conflict("INSERT INTO knowledge_bases(id,name) VALUES ('duplicate',' OPTICS ')", [], 'knowledge_bases_name_unique_idx');
  await pg.exec("INSERT INTO knowledge_bases(id,project_id,name) VALUES ('p1','project-one','Optics'),('p2','project-two','Optics')");
  await pg.exec("UPDATE knowledge_bases SET lifecycle='deleted' WHERE id='global'; INSERT INTO knowledge_bases(id,name) VALUES ('replacement','Optics')");
  await conflict("UPDATE knowledge_bases SET lifecycle='active' WHERE id='global'", [], 'knowledge_bases_name_unique_idx');
  await pg.exec("INSERT INTO model_models VALUES ('one','first','Teaching'),('two','first','Teaching')");
  await conflict("INSERT INTO model_models VALUES ('one','second',' TEACHING ')", [], 'model_models_name_unique_idx');

  // Duplicate failure rolls back all writes in a multi-object transaction, including its audit.
  await pg.exec('CREATE TABLE fixture_audit(action text)');
  await pg.exec('BEGIN');
  await pg.exec("INSERT INTO fixture_audit VALUES ('should roll back'); INSERT INTO admin_teams VALUES ('transactional','Fresh',true)");
  await conflict("INSERT INTO admin_teams VALUES ('transactional-copy','optics lab',true)", [], 'admin_teams_name_unique_idx');
  await pg.exec('ROLLBACK');
  assert.equal((await pg.query("SELECT * FROM admin_teams WHERE id='transactional'")).rows.length, 0);
  assert.equal((await pg.query('SELECT * FROM fixture_audit')).rows.length, 0); checks++;

  // Existing duplicates abort deployment without silently renaming/removing any row.
  await pg.exec(down);
  await pg.exec("INSERT INTO admin_teams VALUES ('legacy','optics lab',true)");
  const duplicates = await pg.query(readFileSync(join(root, 'tooling/check-resource-name-duplicates.sql'), 'utf8'));
  assert.deepEqual(duplicates.rows.map(row => ({ category: row.category, ids: row.resource_ids })), [
    { category: 'team', ids: ['first', 'legacy'] },
  ]); checks++;
  await pg.exec('BEGIN');
  await assert.rejects(pg.exec(migration), error => error.code === '23505');
  await pg.exec('ROLLBACK');
  assert.equal((await pg.query("SELECT name FROM admin_teams WHERE id='legacy'")).rows[0].name, 'optics lab');
  await pg.exec("UPDATE admin_teams SET name='Legacy Optics' WHERE id='legacy'");
  await pg.exec(migration); checks++;
  console.log(`PASS: ${checks} isolated PostgreSQL checks (normalization, create, rename, concurrency, scopes, rollback and legacy duplicates).`);
} finally { await pg.close(); }
