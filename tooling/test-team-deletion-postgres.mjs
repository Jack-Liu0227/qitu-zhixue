import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.env.QITU_VERIFY_DEPENDENCY_ROOT, 'Set isolated PGlite dependency root');
const external = createRequire(join(process.env.QITU_VERIFY_DEPENDENCY_ROOT, 'package.json'));
const { PGlite } = external('@electric-sql/pglite');
const pglitePeer = external.resolve('@electric-sql/pglite');
registerHooks({ resolve(specifier, context, next) {
  if (specifier !== '@electric-sql/pglite') return next(specifier, context);
  return next(context.conditions.includes('require') ? pglitePeer : pathToFileURL(pglitePeer).href, context);
} });
const require = createRequire(join(root, 'services/api/package.json'));
const { drizzle } = require('drizzle-orm/pglite');
const { getTableConfig } = require('drizzle-orm/pg-core');
const schema = require('@qitu/database');
const build = process.env.QITU_TEAM_TEST_API_DIST || join(root,
  JSON.parse(readFileSync(join(root, 'services/api/.tmp/pbl-capability/verification.json'), 'utf8')).runDirectory, 'dist');
const { PlatformRegistryService } = require(join(build, 'modules/platform-registry/platform-registry.service.js'));
const { PostgresTemplateBindingStore } = require(join(build, 'modules/templates/templates-binding.store.postgres.js'));
const pg = new PGlite();
const db = drizzle(pg);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const checks = [];
try {
  for (const table of [schema.adminTeams, schema.adminTeamMembers, schema.projectTemplates, schema.projectTemplateVersions,
    schema.pblTemplateTeamBindings, schema.projectBindingSnapshots]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => `${quote(column.name)} ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}`);
    await pg.exec(`CREATE TABLE ${quote(config.name)} (${columns.join(', ')})`);
  }
  await pg.exec(`
    ALTER TABLE admin_team_members ADD FOREIGN KEY (team_id) REFERENCES admin_teams(id);
    ALTER TABLE pbl_template_team_bindings ADD FOREIGN KEY (template_version_id) REFERENCES project_template_versions(id);
    ALTER TABLE project_binding_snapshots ADD FOREIGN KEY (binding_id) REFERENCES pbl_template_team_bindings(id);
    INSERT INTO admin_teams(id,name,leader_assistant_id,updated_at) VALUES
      ('team','Editable team','assistant','2026-10-26T12:00:00Z'),('other','Other team','assistant','2026-10-26T12:00:00Z');
    INSERT INTO admin_team_members(slot_id,team_id,assistant_id) VALUES ('member','team','assistant'),('other-member','other','assistant');
    INSERT INTO project_templates(id,title,status) VALUES ('template','Frozen course','published'),('draft','Draft course','draft'),('unrelated','Other course','published');
    INSERT INTO project_template_versions(id,template_id,version,status,content,created_at) VALUES
      ('version-1','template','v1','published','{"linkedTeamId":"team"}',now()),
      ('version-2','template','v2','archived','{}',now()),
      ('draft-version','draft','v1','draft','{"linkedTeamId":"team"}',now()),
      ('unrelated-version','unrelated','v1','published','{"linkedTeamId":"other"}',now());
  `);
  const frozen = { id: 'frozen', teamId: 'team', version: 1, name: 'Frozen team name', description: 'Frozen configuration',
    workspaceMode: 'shared', sessionMode: 'supervised', leaderAssistantId: 'assistant', members: [], pblSpec: {}, enabled: true,
    createdBy: 'admin', createdAt: '2026-10-25T00:00:00.000Z' };
  for (const [id, version, status, snapshots] of [
    ['binding-1', 'version-1', 'active', { frozen }],
    ['binding-2', 'version-2', 'retired', { primary: { ...frozen, id: 'primary', teamId: 'other' }, secondary: frozen, repeated: { ...frozen, id: 'repeated' } }],
    ['other-binding', 'unrelated-version', 'active', { frozen: { ...frozen, teamId: 'other' } }],
  ]) {
    await pg.query(`INSERT INTO pbl_template_team_bindings(id,template_version_id,team_version_id,status,team_snapshots,binding_hash,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,'unchanged-hash',now(),now())`, [id, version, Object.keys(snapshots)[0], status, JSON.stringify(snapshots)]);
  }
  await pg.exec(`INSERT INTO project_binding_snapshots(project_id,template_version_id,binding_id,team_version_id,binding_hash,bound_at) VALUES
    ('project-1','version-1','binding-1','frozen','unchanged-hash',now()),
    ('project-2','version-2','binding-2','primary','unchanged-hash',now()),
    ('project-3','version-2','binding-2','primary','unchanged-hash',now()),
    ('other-project','unrelated-version','other-binding','frozen','unchanged-hash',now())`);
  const actor = { id: 'admin-fixture', role: 'admin', displayName: 'Fixture' };
  const before = {};
  for (const name of ['project_templates', 'project_template_versions', 'pbl_template_team_bindings', 'project_binding_snapshots']) {
    before[name] = (await pg.query(`SELECT * FROM ${name} ORDER BY 1`)).rows;
  }
  let failAudit = true; const audits = [];
  const service = new PlatformRegistryService(db, 'live', { write: async (entry, tx) => {
    assert.ok(tx); if (failAudit) throw new Error('Synthetic audit failure'); audits.push(entry); return 'fixture-audit';
  } }, {});
  const usage = await service.getTeamTemplateUsage(actor, 'team');
  assert.equal(usage.templateCount, 2); assert.equal(usage.templates.length, 3);
  assert.equal(usage.bindingCount, 2); assert.equal(usage.projectCount, 3);
  assert.equal(usage.templates.find(item => item.templateVersionId === 'version-2').linkedInTemplate, false);
  assert.equal(usage.templates.find(item => item.templateVersionId === 'draft-version').bindings.length, 0);
  checks.push('references-use-source-ids', 'multiple-snapshots-do-not-double-count', 'non-primary-teams-and-draft-links-visible', 'unrelated-projects-excluded');
  await assert.rejects(service.deleteTeam(actor, 'team', usage.teamUpdatedAt), /Synthetic audit failure/);
  assert.equal((await pg.query("SELECT count(*)::int n FROM admin_team_members WHERE team_id='team'")).rows[0].n, 1);
  assert.equal((await pg.query("SELECT count(*)::int n FROM admin_teams WHERE id='team'")).rows[0].n, 1);
  checks.push('audit-failure-rolls-back-team-and-members');
  failAudit = false;
  await assert.rejects(service.deleteTeam(actor, 'team', '2026-10-25T00:00:00.000Z'), error => error.getStatus() === 409);
  checks.push('stale-revision-refused');
  await service.deleteTeam(actor, 'team', usage.teamUpdatedAt);
  assert.equal((await pg.query("SELECT count(*)::int n FROM admin_teams WHERE id='team'")).rows[0].n, 0);
  assert.equal((await pg.query("SELECT count(*)::int n FROM admin_team_members WHERE team_id='team'")).rows[0].n, 0);
  assert.equal((await pg.query("SELECT count(*)::int n FROM admin_team_members WHERE team_id='other'")).rows[0].n, 1);
  checks.push('referenced-team-deleted', 'unrelated-team-preserved');
  for (const name of Object.keys(before)) {
    assert.deepEqual((await pg.query(`SELECT * FROM ${name} ORDER BY 1`)).rows, before[name]);
    checks.push(name + '-unchanged');
  }
  const bindingStore = new PostgresTemplateBindingStore(db);
  const retained = await bindingStore.findTeamVersion('frozen', 'binding-1');
  assert.equal(retained.teamId, 'team'); assert.equal(retained.name, 'Frozen team name');
  assert.equal(retained.createdAt.toISOString(), frozen.createdAt);
  assert.equal(audits.length, 1); assert.equal(audits[0].detail.retainedProjectCount, 3);
  checks.push('runtime-owner-resolves-frozen-team-after-deletion', 'audited-reference-counts');
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await pg.close(); }
