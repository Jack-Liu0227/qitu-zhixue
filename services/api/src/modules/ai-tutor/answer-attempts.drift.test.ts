import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * F1.4：`answer_attempts` 判分证据表的数据层文件级断言。
 *
 * 目的（防 T8 那类漂移）：迁移 SQL、drizzle schema 声明、journal 三者必须
 * 逐字一致；表不得有任何 HTTP/客户端读写路径。风格参照
 * pbl-gate-evidence.test.ts 的 repoRoot() + readFileSync 断言。
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

const TAG = '0031_answer_attempts';
const TABLE = 'answer_attempts';
const UNIQUE_IDX = 'answer_attempts_student_quiz_key_unique_idx';
const QUIZ_IDX = 'answer_attempts_student_quiz_idx';
const CREATED_IDX = 'answer_attempts_student_created_idx';
const PLAN_OBJECTIVE_IDX = 'answer_attempts_plan_objective_idx';

function readUp(root: string): string {
  return readFileSync(join(root, 'database', 'migrations', `${TAG}.sql`), 'utf8').replace(/\r\n/g, '\n');
}
function readDown(root: string): string {
  return readFileSync(join(root, 'database', 'migrations', `${TAG}.down.sql`), 'utf8').replace(/\r\n/g, '\n');
}
function readSchema(root: string): string {
  return readFileSync(join(root, 'packages', 'database', 'src', 'schema', 'answer-attempts.ts'), 'utf8').replace(/\r\n/g, '\n');
}

test('journal is monotonic, preserves 0031 and registers every up migration', () => {
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
  assert.ok(ledger, '0031 must remain registered when later migrations are appended');
  assert.equal(ledger.idx, 31);
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

test('0031 up migration creates the ledger table with the pinned columns and indexes, re-runnable', () => {
  const sql = readUp(repoRoot());
  assert.equal(/^CREATE TABLE (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE TABLE');
  assert.equal(/^CREATE INDEX (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE INDEX');
  assert.equal(/^CREATE UNIQUE INDEX (?!IF NOT EXISTS)/m.test(sql), false, 'up must not contain a bare CREATE UNIQUE INDEX');

  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${TABLE}" \\(`));
  assert.match(sql, /"id" text PRIMARY KEY NOT NULL/);
  assert.match(sql, /"school_id" text REFERENCES "schools"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"student_user_id" text NOT NULL REFERENCES "users"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"tutor_session_id" text NOT NULL REFERENCES "tutor_sessions"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"quiz_id" text NOT NULL/);
  assert.match(sql, /"objective_id" text REFERENCES "learning_objectives"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"plan_id" text REFERENCES "learning_plans"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"concept_id" text NOT NULL/);
  assert.match(sql, /"result" text NOT NULL/);
  assert.match(sql, /"is_correct" boolean NOT NULL DEFAULT false/);
  assert.match(sql, /"assessment_type" text NOT NULL DEFAULT 'quiz'/);
  assert.match(sql, /"error_type" text/);
  assert.match(sql, /"hints_used" integer NOT NULL DEFAULT 0/);
  assert.match(sql, /"attempt_count" integer NOT NULL DEFAULT 1/);
  assert.match(sql, /"quality_basis_points" integer/);
  assert.match(sql, /"user_answer" text/);
  assert.match(sql, /"idempotency_key" text NOT NULL/);
  assert.match(sql, /"created_at" timestamptz NOT NULL DEFAULT now\(\)/);

  // 幂等写入核心：唯一索引列集合与顺序逐字钉死（容忍换行）。
  assert.match(
    sql,
    new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS "${UNIQUE_IDX}"\\s+ON "${TABLE}" \\("student_user_id", "quiz_id", "idempotency_key"\\)`),
  );
  assert.match(
    sql,
    new RegExp(`CREATE INDEX IF NOT EXISTS "${QUIZ_IDX}"\\s+ON "${TABLE}" \\("student_user_id", "quiz_id"\\)`),
  );
  assert.match(
    sql,
    new RegExp(`CREATE INDEX IF NOT EXISTS "${CREATED_IDX}"\\s+ON "${TABLE}" \\("student_user_id", "created_at"\\)`),
  );
  assert.match(
    sql,
    new RegExp(`CREATE INDEX IF NOT EXISTS "${PLAN_OBJECTIVE_IDX}"\\s+ON "${TABLE}" \\("plan_id", "objective_id"\\)`),
  );
});

test('0031 down migration drops in reverse dependency order and is re-runnable', () => {
  const sql = readDown(repoRoot());
  assert.match(sql, new RegExp(`DROP INDEX IF EXISTS "${PLAN_OBJECTIVE_IDX}";`));
  assert.match(sql, new RegExp(`DROP INDEX IF EXISTS "${CREATED_IDX}";`));
  assert.match(sql, new RegExp(`DROP INDEX IF EXISTS "${QUIZ_IDX}";`));
  assert.match(sql, new RegExp(`DROP INDEX IF EXISTS "${UNIQUE_IDX}";`));
  assert.match(sql, new RegExp(`DROP TABLE IF EXISTS "${TABLE}";`));
  const plan = sql.indexOf(PLAN_OBJECTIVE_IDX);
  const created = sql.indexOf(CREATED_IDX);
  const quiz = sql.indexOf(QUIZ_IDX);
  const unique = sql.indexOf(UNIQUE_IDX);
  const table = sql.indexOf('DROP TABLE');
  assert.ok(
    plan < created && created < quiz && quiz < unique && unique < table,
    'down must drop indexes before the table (reverse dependency order)',
  );
});

test('drizzle schema declares the ledger with the same index names and columns as the migration', () => {
  const root = repoRoot();
  const schema = readSchema(root);
  assert.match(schema, /pgTable\(\s*'answer_attempts'/);
  assert.match(schema, /text\('id'\)\.primaryKey\(\)/);
  assert.match(schema, /text\('school_id'\)\.references\(\(\) => schools\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /text\('student_user_id'\)\s*\.notNull\(\)\s*\.references\(\(\) => users\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /text\('tutor_session_id'\)\s*\.references\(\(\) => tutorSessions\.id, \{ onDelete: 'set null' \}\)/);
  assert.match(schema, /quizId: text\('quiz_id'\)\.notNull\(\)/);
  assert.match(schema, /objectiveId: text\('objective_id'\)\.references\(\(\) => learningObjectives\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /planId: text\('plan_id'\)\.references\(\(\) => learningPlans\.id, \{ onDelete: 'restrict' \}\)/);
  assert.match(schema, /conceptId: text\('concept_id'\)\.notNull\(\)/);
  assert.match(schema, /result: text\('result'\)\.notNull\(\)/);
  assert.match(schema, /isCorrect: boolean\('is_correct'\)\.notNull\(\)\.default\(false\)/);
  assert.match(schema, /assessmentType: text\('assessment_type'\)\.notNull\(\)\.default\('quiz'\)/);
  assert.match(schema, /errorType: text\('error_type'\)/);
  assert.match(schema, /hintsUsed: integer\('hints_used'\)\.notNull\(\)\.default\(0\)/);
  assert.match(schema, /attemptCount: integer\('attempt_count'\)\.notNull\(\)\.default\(1\)/);
  assert.match(schema, /qualityBasisPoints: integer\('quality_basis_points'\)/);
  assert.match(schema, /userAnswer: text\('user_answer'\)/);
  assert.match(schema, /idempotencyKey: text\('idempotency_key'\)\.notNull\(\)/);
  assert.match(schema, /createdAt: timestamp\('created_at', \{ withTimezone: true \}\)\.notNull\(\)\.defaultNow\(\)/);

  assert.match(
    schema,
    new RegExp(`uniqueIndex\\('${UNIQUE_IDX}'\\)\\s*\\.on\\(\\s*table\\.studentUserId,\\s*table\\.quizId,\\s*table\\.idempotencyKey,?\\s*\\)`),
  );
  assert.match(schema, new RegExp(`index\\('${QUIZ_IDX}'\\)\\s*\\.on\\(\\s*table\\.studentUserId,\\s*table\\.quizId,?\\s*\\)`));
  assert.match(schema, new RegExp(`index\\('${CREATED_IDX}'\\)\\s*\\.on\\(\\s*table\\.studentUserId,\\s*table\\.createdAt,?\\s*\\)`));
  assert.match(schema, new RegExp(`index\\('${PLAN_OBJECTIVE_IDX}'\\)\\s*\\.on\\(\\s*table\\.planId,\\s*table\\.objectiveId,?\\s*\\)`));

  const index = readFileSync(join(root, 'packages', 'database', 'src', 'schema', 'index.ts'), 'utf8');
  assert.match(index, /export \* from '\.\/answer-attempts';/);
});

test('the ledger is server-private: no controller anywhere references answer_attempts', () => {
  const modulesDir = join(repoRoot(), 'services', 'api', 'src', 'modules');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.controller.ts')) {
        const source = readFileSync(full, 'utf8');
        if (/answer_attempts|answerAttempts|answer-attempts/.test(source)) offenders.push(entry.name);
      }
    }
  };
  walk(modulesDir);
  assert.deepEqual(offenders, [], `HTTP controllers must never expose the answer ledger: ${offenders.join(', ')}`);
});
