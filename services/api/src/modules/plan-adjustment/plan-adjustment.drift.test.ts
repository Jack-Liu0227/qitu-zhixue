import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * F4：迁移 0033 `project_plan_adjustments` 的数据层文件级断言。
 *
 * 目的（防 T8 那类漂移）：迁移 SQL、drizzle schema 声明、journal 三者必须
 * 逐字一致；down 脚本必须按依赖逆序撤销 up 脚本（先删索引，再删表）。
 * 风格参照 answer-attempts.drift.test.ts 的 repoRoot() + readFileSync 断言。
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

const TAG = '0033_plan_adjustments';
const TABLE = 'project_plan_adjustments';
const PROJECT_KEY_IDX = 'project_plan_adjustments_project_key_unique_idx';
const TRIGGER_KEY_IDX = 'project_plan_adjustments_trigger_key_unique_idx';
const REVISION_CHAIN_IDX = 'project_plan_adjustments_revision_chain_unique_idx';
const PROJECT_STATUS_IDX = 'project_plan_adjustments_project_status_idx';
const STEM_NODE_IDX = 'project_plan_adjustments_stem_node_idx';

function readUp(root: string): string {
  return readFileSync(join(root, 'database', 'migrations', `${TAG}.sql`), 'utf8').replace(/\r\n/g, '\n');
}
function readDown(root: string): string {
  return readFileSync(join(root, 'database', 'migrations', `${TAG}.down.sql`), 'utf8').replace(/\r\n/g, '\n');
}
function readSchema(root: string): string {
  return readFileSync(join(root, 'packages', 'database', 'src', 'schema', 'plan-adjustments.ts'), 'utf8').replace(/\r\n/g, '\n');
}

test('journal is monotonic, preserves 0033 and registers every up migration', () => {
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
  assert.ok(ledger, '0033 must remain registered when later migrations are appended');
  assert.equal(ledger.idx, 33);
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

test('0033 up migration creates the ledger table with pinned columns and indexes, re-runnable', () => {
  const sql = readUp(repoRoot());
  assert.equal(/^CREATE TABLE (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE TABLE');
  assert.equal(/^CREATE INDEX (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE INDEX');
  assert.equal(/^CREATE UNIQUE INDEX (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE UNIQUE INDEX');

  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${TABLE}" \\(`));
  assert.match(sql, /"id" text PRIMARY KEY NOT NULL/);
  assert.match(sql, /"project_id" text NOT NULL REFERENCES "projects"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"plan_id" text NOT NULL REFERENCES "learning_plans"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"stem_node_id" text NOT NULL/);
  assert.match(sql, /"base_revision" integer NOT NULL/);
  assert.match(sql, /"next_revision" integer NOT NULL/);
  assert.match(sql, /"trigger" text NOT NULL/);
  assert.match(sql, /"evidence_refs" jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /"action" text NOT NULL/);
  assert.match(sql, /"status" text NOT NULL/);
  assert.match(sql, /"policy_version" text NOT NULL/);
  assert.match(sql, /"idempotency_key" text NOT NULL/);
  assert.match(sql, /"remedial_depth" integer NOT NULL DEFAULT 0/);
  assert.match(sql, /"remediation_payload" jsonb/);
  assert.match(sql, /"trigger_key" text NOT NULL/);
  assert.match(sql, /"created_at" timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /"updated_at" timestamptz NOT NULL DEFAULT now\(\)/);

  // 幂等写入核心：节点级幂等键 + triggerKey 唯一键。
  assert.match(
    sql,
    new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${PROJECT_KEY_IDX}" ON "${TABLE}" \\("project_id", "idempotency_key"\\)`),
  );
  assert.match(
    sql,
    new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${TRIGGER_KEY_IDX}" ON "${TABLE}" \\("trigger_key"\\)`),
  );
  // 局部唯一索引：revision 链唯一，只约束 append 动作（recommend 会撞键）。
  assert.match(
    sql,
    new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${REVISION_CHAIN_IDX}" ON "${TABLE}" \\("project_id", "base_revision", "next_revision"\\) WHERE "action" = 'append_optional_remediation'`),
  );
  assert.match(
    sql,
    new RegExp(`CREATE INDEX IF NOT EXISTS "${PROJECT_STATUS_IDX}" ON "${TABLE}" \\("project_id", "status"\\)`),
  );
  assert.match(
    sql,
    new RegExp(`CREATE INDEX IF NOT EXISTS "${STEM_NODE_IDX}" ON "${TABLE}" \\("project_id", "stem_node_id"\\)`),
  );
});

test('0033 down migration drops indexes before the table and is re-runnable', () => {
  const sql = readDown(repoRoot());
  for (const idx of [STEM_NODE_IDX, PROJECT_STATUS_IDX, REVISION_CHAIN_IDX, TRIGGER_KEY_IDX, PROJECT_KEY_IDX]) {
    assert.match(sql, new RegExp(`DROP INDEX IF EXISTS "${idx}";`));
  }
  assert.match(sql, new RegExp(`DROP TABLE IF EXISTS "${TABLE}";`));

  const indexPositions = [STEM_NODE_IDX, PROJECT_STATUS_IDX, REVISION_CHAIN_IDX, TRIGGER_KEY_IDX, PROJECT_KEY_IDX].map((idx) =>
    sql.indexOf(`DROP INDEX IF EXISTS "${idx}"`),
  );
  const table = sql.indexOf(`DROP TABLE IF EXISTS "${TABLE}"`);
  for (const position of indexPositions) {
    assert.ok(position >= 0 && position < table, 'every index must drop before the table');
  }
  const [stemNode, projectStatus, revisionChain, triggerKey, projectKey] = indexPositions;
  assert.ok(stemNode !== undefined, 'stem_node index must be present');
  assert.ok(projectStatus !== undefined, 'project_status index must be present');
  assert.ok(revisionChain !== undefined, 'revision_chain index must be present');
  assert.ok(triggerKey !== undefined, 'trigger_key index must be present');
  assert.ok(projectKey !== undefined, 'project_key index must be present');
  assert.ok(
    stemNode < projectStatus &&
      projectStatus < revisionChain &&
      revisionChain < triggerKey &&
      triggerKey < projectKey,
    'indexes must drop in reverse creation order',
  );
});

test('drizzle schema declares the ledger with the same index names and columns as the migration', () => {
  const root = repoRoot();
  const schema = readSchema(root);
  assert.match(schema, /pgTable\(\s*'project_plan_adjustments'/);
  assert.match(schema, /id: text\('id'\)\.primaryKey\(\)/);
  assert.match(schema, /projectId: text\('project_id'\)\s*\.notNull\(\)\s*\.references\(\(\) => projects\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /planId: text\('plan_id'\)\s*\.notNull\(\)\s*\.references\(\(\) => learningPlans\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /stemNodeId: text\('stem_node_id'\)\.notNull\(\)/);
  assert.match(schema, /baseRevision: integer\('base_revision'\)\.notNull\(\)/);
  assert.match(schema, /nextRevision: integer\('next_revision'\)\.notNull\(\)/);
  assert.match(schema, /trigger: text\('trigger'\)\.notNull\(\)/);
  assert.match(schema, /evidenceRefs: jsonb\('evidence_refs'\)/);
  assert.match(schema, /action: text\('action'\)\.notNull\(\)/);
  assert.match(schema, /status: text\('status'\)\.notNull\(\)/);
  assert.match(schema, /policyVersion: text\('policy_version'\)\.notNull\(\)/);
  assert.match(schema, /idempotencyKey: text\('idempotency_key'\)\.notNull\(\)/);
  assert.match(schema, /remedialDepth: integer\('remedial_depth'\)\.notNull\(\)\.default\(0\)/);
  assert.match(schema, /remediationPayload: jsonb\('remediation_payload'\)/);
  assert.match(schema, /triggerKey: text\('trigger_key'\)\.notNull\(\)/);
  assert.match(schema, /createdAt: timestamp\('created_at', \{ withTimezone: true \}\)\.notNull\(\)\.defaultNow\(\)/);
  assert.match(schema, /updatedAt: timestamp\('updated_at', \{ withTimezone: true \}\)\.notNull\(\)\.defaultNow\(\)/);

  assert.match(
    schema,
    new RegExp(`projectKeyUniqueIdx: uniqueIndex\\('${PROJECT_KEY_IDX}'\\)\\s*\\.on\\(\\s*table\\.projectId,\\s*table\\.idempotencyKey,?\\s*\\)`),
  );
  assert.match(
    schema,
    new RegExp(`triggerKeyUniqueIdx: uniqueIndex\\('${TRIGGER_KEY_IDX}'\\)\\s*\\.on\\(\\s*table\\.triggerKey,?\\s*\\)`),
  );
  assert.match(
    schema,
    new RegExp(`revisionChainUniqueIdx: uniqueIndex\\(\\s*'${REVISION_CHAIN_IDX}',?\\s*\\)\\s*\\.on\\(\\s*table\\.projectId,\\s*table\\.baseRevision,\\s*table\\.nextRevision,?\\s*\\)`),
  );
  assert.match(schema, /\.where\(sql`\$\{table\.action\} = 'append_optional_remediation'`\)/);
  assert.match(
    schema,
    new RegExp(`projectStatusIdx: index\\('${PROJECT_STATUS_IDX}'\\)\\s*\\.on\\(\\s*table\\.projectId,\\s*table\\.status,?\\s*\\)`),
  );
  assert.match(
    schema,
    new RegExp(`stemNodeIdx: index\\('${STEM_NODE_IDX}'\\)\\s*\\.on\\(\\s*table\\.projectId,\\s*table\\.stemNodeId,?\\s*\\)`),
  );

  const index = readFileSync(join(root, 'packages', 'database', 'src', 'schema', 'index.ts'), 'utf8');
  assert.match(index, /export \* from '\.\/plan-adjustments';/);
});
