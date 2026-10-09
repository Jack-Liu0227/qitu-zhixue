#!/usr/bin/env tsx
/**
 * 按固定顺序执行 database/seeds/ 下的确定性种子（幂等，可重复运行）。
 *
 * 执行顺序（不可调换，后一个文件引用前一个建立的外键目标）：
 *   1. demo-identities.sql   —— schools / users / guardian_links / mentor_assignments。
 *       建立演示学校 school-demo 与 admin-demo / teacher-demo / student-demo 等演示身份。
 *   2. tutor-workspace.sql   —— tutor_partners / tutor_template_documents / tutor_knowledge_documents。
 *       需在身份之后；domain-foundation 的 student_memories.partner_id 引用 tutor_partners。
 *   3. domain-foundation.sql —— 规范化领域表（project_templates / project_template_versions /
 *       knowledge_documents / knowledge_chunks / learning_plans(+modules/objectives/sessions) /
 *       mastery_records / mastery_attempts / growth_records / student_memories / mentor_reviews）。
 *       需在身份与工作区之后：created_by / student_user_id / mentor_user_id / partner_id 引用前两者。
 *   4. admin-ai-config.sql —— admin AI 配置（admin_assistants / admin_teams / admin_team_members）。
 *       迁移 0019 建表后执行；内容与 @qitu/ai-client 的 BUILTIN_ASSISTANTS /
 *       THUNDER_FIGHTER_TEAM_CONFIG 对齐，供 admin 控制台两张表真实落库。
 *
 * 种子内容只有一份真源（上面的 .sql 文件），本脚本只负责按序执行，
 * 避免 SQL 与 TS 两份数据漂移。
 *
 * 用法：
 *   DATABASE_URL=postgresql://user:pass@host:5432/qitu_dev pnpm --filter @qitu/database seed
 *   pnpm --filter @qitu/database exec tsx src/seed.ts --check   # 只校验证种子文件存在与顺序，不连库
 *
 * 注意：连接串只从环境变量读取，仓库内不保存任何口令。
 */
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const SEEDS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../database/seeds');

/** 确定性执行顺序；数组顺序即外键依赖顺序，禁止重排。 */
const SEED_FILES = ['demo-identities.sql', 'tutor-workspace.sql', 'domain-foundation.sql', 'admin-ai-config.sql'] as const;

type SeedFile = (typeof SEED_FILES)[number];

function seedPath(file: SeedFile): string {
  return resolve(SEEDS_DIR, file);
}

/** 依次读取并拼接种子 SQL；文件头带注释标记，便于日志定位。 */
async function loadSeedSql(): Promise<string> {
  const chunks: string[] = [];
  for (const file of SEED_FILES) {
    const sql = await readFile(seedPath(file), 'utf8');
    chunks.push(`-- >>> seed: ${file}\n${sql}`);
  }
  return chunks.join('\n');
}

/** 不连库的确定性校验：只检查种子文件可读并确认执行顺序。 */
async function checkSeedPaths(): Promise<void> {
  for (const file of SEED_FILES) {
    await access(seedPath(file), constants.R_OK);
    console.log(`seed path ok: ${file}`);
  }
  console.log(`seed order: ${SEED_FILES.join(' -> ')}`);
}

async function seed(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL 未设置。请先导出连接串，例如：');
    console.error('  export DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/qitu_dev');
    process.exit(1);
  }

  const sql = await loadSeedSql();
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    const before = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users',
    );
    await client.query(sql);
    const after = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users',
    );
    const templates = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM project_templates',
    );
    console.log(`seed ok: ${SEED_FILES.join(' -> ')}`);
    console.log(
      `seed ok: users ${before.rows[0]?.count ?? '?'} -> ${after.rows[0]?.count ?? '?'}, ` +
        `project_templates ${templates.rows[0]?.count ?? '?'} (幂等；身份/模板冲突时修正，运行期记录冲突时保留)`,
    );
  } catch (error) {
    console.error('seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    await checkSeedPaths();
    return;
  }
  await seed();
}

void main();
