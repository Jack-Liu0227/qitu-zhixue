#!/usr/bin/env tsx
/**
 * 执行 database/seeds/demo-identities.sql。
 *
 * 种子内容只有一份真源（那个 .sql 文件），本脚本只负责把它跑起来，
 * 避免 SQL 与 TS 两份数据漂移。
 *
 * 用法：
 *   DATABASE_URL=postgresql://user:pass@host:5432/qitu_dev pnpm --filter @qitu/database seed
 *
 * 注意：连接串只从环境变量读取，仓库内不保存任何口令。
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const SEED_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../database/seeds/demo-identities.sql',
);

async function seed(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL 未设置。请先导出连接串，例如：');
    console.error('  export DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/qitu_dev');
    process.exit(1);
  }

  const sql = await readFile(SEED_FILE, 'utf8');
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
    console.log(
      `seed ok: users ${before.rows[0]?.count ?? '?'} -> ${after.rows[0]?.count ?? '?'} (幂等；身份冲突时修正，关系冲突时保留)`,
    );
  } catch (error) {
    console.error('seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void seed();
