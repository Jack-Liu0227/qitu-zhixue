import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * T21：`pbl_gate_evidence` 待冲刷账本的数据层文件级断言。
 *
 * 目的（防 T8 那类漂移）：迁移 SQL、drizzle schema 声明、journal 三者必须
 * 逐字一致；表不得有任何 HTTP/客户端读写路径。风格参照
 * team-runtime.gate.test.ts 的 repoRoot() + readFileSync 断言。
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

const TAG = '0022_pbl_gate_evidence';
const TABLE = 'pbl_gate_evidence';
const UNIQUE_IDX = 'pbl_gate_evidence_student_gate_ref_unique_idx';
const PENDING_IDX = 'pbl_gate_evidence_student_pending_idx';

function readUp(root: string): string {
  return readFileSync(join(root, 'database', 'migrations', `${TAG}.sql`), 'utf8').replace(/\r\n/g, '\n');
}
function readDown(root: string): string {
  return readFileSync(join(root, 'database', 'migrations', `${TAG}.down.sql`), 'utf8').replace(/\r\n/g, '\n');
}
function readSchema(root: string): string {
  return readFileSync(join(root, 'packages', 'database', 'src', 'schema', 'pbl-gate-evidence.ts'), 'utf8').replace(/\r\n/g, '\n');
}

test('journal is append-only monotonic and 0022_pbl_gate_evidence is the head entry', () => {
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
  const head = previous;
  assert.equal(head.idx, 22);
  assert.equal(head.tag, TAG);
  assert.equal(head.version, '7');
  assert.equal(head.breakpoints, true);
  // 每个 entry 的 tag 都必须与 up/down 文件名一致（防止 tag 与文件漂移）。
  for (const entry of entries) {
    assert.ok(existsSync(join(root, 'database', 'migrations', `${entry.tag}.sql`)), `missing up file for ${entry.tag}`);
    if (entry.breakpoints) {
      assert.ok(existsSync(join(root, 'database', 'migrations', `${entry.tag}.down.sql`)), `missing down file for ${entry.tag}`);
    }
  }
});

test('0022 up migration creates the ledger table with the pinned columns and both indexes, re-runnable', () => {
  const sql = readUp(repoRoot());
  // 可重跑：任何建表/建索引语句必须带 IF NOT EXISTS（拒绝裸创建）。
  assert.equal(/^CREATE TABLE (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE TABLE');
  assert.equal(/^CREATE INDEX (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE INDEX');
  assert.equal(/^CREATE UNIQUE INDEX (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE UNIQUE INDEX');

  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${TABLE}" \\(`));
  // 列集合（snake_case + NOT NULL + FK）
  assert.match(sql, /"id" text PRIMARY KEY NOT NULL/);
  assert.match(sql, /"student_user_id" text NOT NULL REFERENCES "users"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"gate" text NOT NULL/);
  assert.match(sql, /"evidence_ref" text NOT NULL/);
  assert.match(sql, /"source" text NOT NULL/);
  assert.match(sql, /"created_at" timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /"consumed_run_id" text,/);
  assert.match(sql, /"consumed_at" timestamptz/);

  // 唯一索引：列集合与顺序逐字钉死（幂等写入核心）。
  assert.match(
    sql,
    new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${UNIQUE_IDX}" ON "${TABLE}" \\("student_user_id", "gate", "evidence_ref"\\)`),
  );
  // 冲刷查询索引：未冲刷 = consumed_at IS NULL。
  assert.match(
    sql,
    new RegExp(`CREATE INDEX IF NOT EXISTS "${PENDING_IDX}" ON "${TABLE}" \\("student_user_id", "consumed_at"\\)`),
  );
});

test('0022 down migration drops in reverse dependency order and is re-runnable', () => {
  const sql = readDown(repoRoot());
  assert.match(sql, new RegExp(`DROP INDEX IF EXISTS "${PENDING_IDX}";`));
  assert.match(sql, new RegExp(`DROP INDEX IF EXISTS "${UNIQUE_IDX}";`));
  assert.match(sql, new RegExp(`DROP TABLE IF EXISTS "${TABLE}";`));
  // 逆序：表必须最后删（先删依赖它的索引）。
  const pending = sql.indexOf(PENDING_IDX);
  const unique = sql.indexOf(UNIQUE_IDX);
  const table = sql.indexOf(`DROP TABLE`);
  assert.ok(pending < unique && unique < table, 'down must drop indexes before the table (reverse dependency order)');
});

test('drizzle schema declares the ledger with the same index names and columns as the migration', () => {
  const root = repoRoot();
  const schema = readSchema(root);
  assert.match(schema, /pgTable\(\s*'pbl_gate_evidence'/);
  assert.match(schema, /text\('student_user_id'\)\s*\.notNull\(\)\s*\.references\(\(\) => users\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /gate: text\('gate'\)\.notNull\(\)/);
  assert.match(schema, /evidenceRef: text\('evidence_ref'\)\.notNull\(\)/);
  assert.match(schema, /source: text\('source'\)\.notNull\(\)/);
  assert.match(schema, /createdAt: timestamp\('created_at', \{ withTimezone: true \}\)\.notNull\(\)\.defaultNow\(\)/);
  assert.match(schema, /consumedRunId: text\('consumed_run_id'\)/);
  assert.match(schema, /consumedAt: timestamp\('consumed_at', \{ withTimezone: true \}\)/);
  // 唯一索引同名同列（同序）。
  assert.match(
    schema,
    new RegExp(`uniqueIndex\\('${UNIQUE_IDX}'\\)\\.on\\(\\s*table\\.studentUserId,\\s*table\\.gate,\\s*table\\.evidenceRef,?\\s*\\)`),
  );
  assert.match(schema, new RegExp(`index\\('${PENDING_IDX}'\\)\\.on\\(table\\.studentUserId, table\\.consumedAt\\)`));

  // schema/index.ts 必须导出该模块（T22/域服务从这里引用）。
  const index = readFileSync(join(root, 'packages', 'database', 'src', 'schema', 'index.ts'), 'utf8');
  assert.match(index, /export \* from '\.\/pbl-gate-evidence';/);
});

test('the ledger is server-private: no controller anywhere references pbl_gate_evidence', () => {
  const modulesDir = join(repoRoot(), 'services', 'api', 'src', 'modules');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.controller.ts')) {
        const source = readFileSync(full, 'utf8');
        if (/pbl_gate_evidence|pblGateEvidence|pbl-gate-evidence/.test(source)) offenders.push(entry.name);
      }
    }
  };
  walk(modulesDir);
  assert.deepEqual(offenders, [], `HTTP controllers must never expose the gate ledger: ${offenders.join(', ')}`);
});
