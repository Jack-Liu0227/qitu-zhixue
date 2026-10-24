import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * F2/F3：迁移 0032 `pbl_template_team_bindings`（含 `admin_team_versions` 与
 * `project_binding_snapshots`）的数据层文件级断言。
 *
 * 目的（防 T8 那类漂移）：迁移 SQL、drizzle schema 声明、journal 三者必须
 * 逐字一致；每个 .down.sql 必须按依赖逆序撤销自己的 .sql。风格参照
 * answer-attempts.drift.test.ts 的 repoRoot() + readFileSync 断言。
 */

function repoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, 'database', 'migrations', 'meta', '_journal.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root with database/migrations not found from ' + process.cwd());
}

const TAG = '0032_pbl_template_team_bindings';
const TEAM_VERSIONS = 'admin_team_versions';
const BINDINGS = 'pbl_template_team_bindings';
const SNAPSHOTS = 'project_binding_snapshots';
const TEAM_VERSION_UNIQUE_IDX = 'admin_team_versions_team_version_unique_idx';
const ONE_ACTIVE_IDX = 'pbl_template_team_bindings_one_active_per_template_idx';
const TEMPLATE_STATUS_IDX = 'pbl_template_team_bindings_template_status_idx';
const TEAM_VERSION_IDX = 'pbl_template_team_bindings_team_version_idx';

function readUp(root: string): string {
  return readFileSync(join(root, 'database', 'migrations', `${TAG}.sql`), 'utf8').replace(/\r\n/g, '\n');
}
function readDown(root: string): string {
  return readFileSync(join(root, 'database', 'migrations', `${TAG}.down.sql`), 'utf8').replace(/\r\n/g, '\n');
}
function readSchema(root: string): string {
  return readFileSync(join(root, 'packages', 'database', 'src', 'schema', 'project-binding.ts'), 'utf8').replace(/\r\n/g, '\n');
}

test('journal is monotonic, preserves 0032 and registers every up migration', () => {
  const root = repoRoot();
  const journal = JSON.parse(readFileSync(join(root, 'database', 'migrations', 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
  };
  const entries = journal.entries;
  assert.ok(entries.length >= 2);
  let previous = entries[0];
  assert.ok(previous, 'journal must not be empty');
  for (let i = 1; i < entries.length; i += 1) {
    const current = entries[i];
    assert.ok(current, `journal entry ${i} must exist`);
    assert.equal(current.idx, previous.idx + 1, `journal idx must stay contiguous at entry ${i}`);
    assert.ok(current.when > previous.when, `journal when must strictly increase at entry ${i}`);
    previous = current;
  }
  const ledger = entries.find((entry) => entry.tag === TAG);
  assert.ok(ledger, '0032 must remain registered when later migrations are appended');
  assert.equal(ledger.idx, 32);
  assert.equal(ledger.version, '7');
  assert.equal(ledger.breakpoints, true);
  const registered = new Set(entries.map((entry) => entry.tag));
  assert.equal(registered.size, entries.length, 'migration tags must be unique');
  for (const file of readdirSync(join(root, 'database', 'migrations'))) {
    if (/^\d{4}_.+\.sql$/.test(file) && !file.endsWith('.down.sql')) {
      assert.ok(registered.has(file.slice(0, -4)), `up migration ${file} is missing from the journal`);
    }
  }
  for (const entry of entries) {
    assert.ok(existsSync(join(root, 'database', 'migrations', `${entry.tag}.sql`)), `missing up file for ${entry.tag}`);
    if (entry.breakpoints) {
      assert.ok(existsSync(join(root, 'database', 'migrations', `${entry.tag}.down.sql`)), `missing down file for ${entry.tag}`);
    }
  }
});

test('0032 up migration creates the three tables with pinned columns and indexes, re-runnable', () => {
  const sql = readUp(repoRoot());
  assert.equal(/^CREATE TABLE (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE TABLE');
  assert.equal(/^CREATE INDEX (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE INDEX');
  assert.equal(/^CREATE UNIQUE INDEX (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE UNIQUE INDEX');

  // Table A：团队不可变版本快照。
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${TEAM_VERSIONS}" \\(`));
  assert.match(sql, /"id" text PRIMARY KEY NOT NULL/);
  assert.match(sql, /"team_id" text NOT NULL REFERENCES "admin_teams"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"version" integer NOT NULL/);
  assert.match(sql, /"name" text NOT NULL/);
  assert.match(sql, /"description" text NOT NULL DEFAULT ''/);
  assert.match(sql, /"workspace_mode" text NOT NULL DEFAULT 'shared'/);
  assert.match(sql, /"session_mode" text NOT NULL DEFAULT 'supervised'/);
  assert.match(sql, /"leader_assistant_id" text NOT NULL REFERENCES "admin_assistants"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"members" jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /"pbl_spec" jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /"enabled" boolean NOT NULL DEFAULT true/);
  assert.match(sql, /"created_by" text,/);
  assert.match(sql, /"created_at" timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(
    sql,
    new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${TEAM_VERSION_UNIQUE_IDX}"\\s+ON "${TEAM_VERSIONS}" \\("team_id", "version"\\)`),
  );

  // Table B：模板版本 ↔ 团队版本绑定。
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${BINDINGS}" \\(`));
  assert.match(sql, /"id" text PRIMARY KEY NOT NULL/);
  assert.match(sql, /"template_version_id" text NOT NULL REFERENCES "project_template_versions"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"team_version_id" text NOT NULL REFERENCES "admin_team_versions"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"status" text NOT NULL DEFAULT 'draft'/);
  assert.match(sql, /"binding_hash" text NOT NULL/);
  assert.match(
    sql,
    /"validation" jsonb NOT NULL DEFAULT '\{"valid":false,"errors":\[\],"warnings":\[\],"checkedAt":null\}'::jsonb/,
  );
  assert.match(sql, /"activated_at" timestamptz/);
  assert.match(sql, /"retired_at" timestamptz/);
  assert.match(sql, /"created_by" text REFERENCES "users"\("id"\)/);
  assert.match(sql, /"created_at" timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /"updated_at" timestamptz NOT NULL DEFAULT now\(\)/);

  // 局部唯一索引：一个模板版本同一时刻最多一个 active 绑定（并发双激活兜底）。
  assert.match(
    sql,
    new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${ONE_ACTIVE_IDX}"\\s+ON "${BINDINGS}" \\("template_version_id"\\)\\s+WHERE "status" = 'active'`),
  );
  assert.match(
    sql,
    new RegExp(`CREATE INDEX IF NOT EXISTS "${TEMPLATE_STATUS_IDX}"\\s+ON "${BINDINGS}" \\("template_version_id", "status"\\)`),
  );
  assert.match(
    sql,
    new RegExp(`CREATE INDEX IF NOT EXISTS "${TEAM_VERSION_IDX}"\\s+ON "${BINDINGS}" \\("team_version_id"\\)`),
  );

  // Table C：项目创建时冻结的绑定快照（不可变，无 updated_at）。
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${SNAPSHOTS}" \\(`));
  assert.match(sql, /"project_id" text PRIMARY KEY NOT NULL REFERENCES "projects"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"template_version_id" text NOT NULL REFERENCES "project_template_versions"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"binding_id" text NOT NULL REFERENCES "pbl_template_team_bindings"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"team_version_id" text NOT NULL REFERENCES "admin_team_versions"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"binding_hash" text NOT NULL/);
  assert.match(sql, /"bound_at" timestamptz NOT NULL/);
  assert.match(sql, /"backfilled" boolean NOT NULL DEFAULT false/);
});

test('0032 down migration drops in reverse dependency order and is re-runnable', () => {
  const sql = readDown(repoRoot());
  // 依赖关系：snapshots → bindings → admin_team_versions；索引先于其表。
  for (const idx of [TEAM_VERSION_IDX, TEMPLATE_STATUS_IDX, ONE_ACTIVE_IDX]) {
    assert.match(sql, new RegExp(`DROP INDEX IF EXISTS "${idx}";`));
  }
  assert.match(sql, new RegExp(`DROP INDEX IF EXISTS "${TEAM_VERSION_UNIQUE_IDX}";`));
  assert.match(sql, new RegExp(`DROP TABLE IF EXISTS "${SNAPSHOTS}";`));
  assert.match(sql, new RegExp(`DROP TABLE IF EXISTS "${BINDINGS}";`));
  assert.match(sql, new RegExp(`DROP TABLE IF EXISTS "${TEAM_VERSIONS}";`));

  const snapshots = sql.indexOf(`DROP TABLE IF EXISTS "${SNAPSHOTS}"`);
  const teamVersionIdx = sql.indexOf(`DROP INDEX IF EXISTS "${TEAM_VERSION_IDX}"`);
  const templateStatusIdx = sql.indexOf(`DROP INDEX IF EXISTS "${TEMPLATE_STATUS_IDX}"`);
  const oneActiveIdx = sql.indexOf(`DROP INDEX IF EXISTS "${ONE_ACTIVE_IDX}"`);
  const bindingsTable = sql.indexOf(`DROP TABLE IF EXISTS "${BINDINGS}"`);
  const teamVersionUniqueIdx = sql.indexOf(`DROP INDEX IF EXISTS "${TEAM_VERSION_UNIQUE_IDX}"`);
  const teamVersionsTable = sql.indexOf(`DROP TABLE IF EXISTS "${TEAM_VERSIONS}"`);

  assert.ok(snapshots >= 0 && snapshots < teamVersionIdx, 'snapshots table must be dropped before binding indexes');
  assert.ok(teamVersionIdx < templateStatusIdx && templateStatusIdx < oneActiveIdx, 'binding indexes must drop in reverse creation order');
  assert.ok(oneActiveIdx < bindingsTable, 'binding indexes must drop before the bindings table');
  assert.ok(bindingsTable < teamVersionUniqueIdx, 'bindings table must drop before the team-versions unique index');
  assert.ok(teamVersionUniqueIdx < teamVersionsTable, 'team-versions unique index must drop before the team-versions table');
});

test('drizzle schema declares the same three tables, columns and index names as the migration', () => {
  const root = repoRoot();
  const schema = readSchema(root);

  assert.doesNotMatch(schema, /export const adminTeamVersions/);
  assert.match(schema, /teamSnapshots: jsonb\('team_snapshots'\)/);

  // pbl_template_team_bindings
  assert.match(schema, new RegExp(`pgTable\\(\\s*'${BINDINGS}'`));
  assert.match(schema, /id: text\('id'\)\.primaryKey\(\)/);
  assert.match(schema, /templateVersionId: text\('template_version_id'\)\s*\.notNull\(\)\s*\.references\(\(\) => projectTemplateVersions\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /status: text\('status'\)\.notNull\(\)\.default\('draft'\)/);
  assert.match(schema, /bindingHash: text\('binding_hash'\)\.notNull\(\)/);
  assert.match(schema, /validation: jsonb\('validation'\)/);
  assert.match(schema, /activatedAt: timestamp\('activated_at', \{ withTimezone: true \}\)/);
  assert.match(schema, /retiredAt: timestamp\('retired_at', \{ withTimezone: true \}\)/);
  assert.match(schema, /createdBy: text\('created_by'\)\.references\(\(\) => users\.id\)/);
  assert.match(schema, /createdAt: timestamp\('created_at', \{ withTimezone: true \}\)\.notNull\(\)\.defaultNow\(\)/);
  assert.match(schema, /updatedAt: timestamp\('updated_at', \{ withTimezone: true \}\)\.notNull\(\)\.defaultNow\(\)/);

  assert.match(
    schema,
    new RegExp(`oneActivePerTemplateIdx: uniqueIndex\\('${ONE_ACTIVE_IDX}'\\)\\s*\\.on\\(\\s*table\\.templateVersionId\\s*\\)`),
  );
  assert.match(schema, /\.where\(sql`\$\{table\.status\} = 'active'`\)/);
  assert.match(
    schema,
    new RegExp(`templateStatusIdx: index\\('${TEMPLATE_STATUS_IDX}'\\)\\s*\\.on\\(\\s*table\\.templateVersionId,\\s*table\\.status,?\\s*\\)`),
  );
  assert.match(
    schema,
    new RegExp(`teamVersionIdx: index\\('${TEAM_VERSION_IDX}'\\)\\s*\\.on\\(\\s*table\\.teamVersionId,?\\s*\\)`),
  );

  // project_binding_snapshots（不可变：无 updated_at、无更新路径）。
  assert.match(schema, new RegExp(`pgTable\\('${SNAPSHOTS}'`));
  assert.match(schema, /projectId: text\('project_id'\)\s*\.primaryKey\(\)\s*\.references\(\(\) => projects\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /templateVersionId: text\('template_version_id'\)\s*\.notNull\(\)\s*\.references\(\(\) => projectTemplateVersions\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /bindingId: text\('binding_id'\)\s*\.notNull\(\)\s*\.references\(\(\) => pblTemplateTeamBindings\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /bindingHash: text\('binding_hash'\)\.notNull\(\)/);
  assert.match(schema, /boundAt: timestamp\('bound_at', \{ withTimezone: true \}\)\.notNull\(\)/);
  assert.match(schema, /backfilled: boolean\('backfilled'\)\.notNull\(\)\.default\(false\)/);

  const index = readFileSync(join(root, 'packages', 'database', 'src', 'schema', 'index.ts'), 'utf8');
  assert.match(index, /export \* from '\.\/project-binding';/);
});
