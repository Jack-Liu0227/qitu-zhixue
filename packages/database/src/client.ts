import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index';

export type Database = ReturnType<typeof createDb>;

/**
 * Create a database client. Does not establish a connection until a query is issued.
 */
export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}

/**
 * Run a function inside a transaction.
 * Supports SELECT ... FOR UPDATE and other row-level locking.
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
