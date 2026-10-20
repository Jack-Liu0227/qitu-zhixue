import { getTableColumns, type SQL, type Table } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@qitu/database';

type Row = Record<string, unknown>;
const dialect = new PgDialect();

/** Disposable persistence fixture: evaluates actual Drizzle predicates, never connects to a database. */
export class ProjectionDatabaseFixture {
  readonly tables = new Map<Table, Row[]>();
  config: Row = { growthProjection: { profileAssistantId: 'profile', growthAssistantId: 'growth' } };
  failInsertTable?: Table;

  get db(): Database { return this as unknown as Database; }
  rows(table: Table): Row[] { return this.tables.get(table) ?? []; }
  seed(table: Table, rows: Row[]) { this.tables.set(table, rows); return this; }
  select() { return new Query(this, 'select'); }
  update(table: Table) { return new Query(this, 'update', table); }
  insert(table: Table) { return new Query(this, 'insert', table); }
  async execute(statement: SQL): Promise<{ rows: Row[] }> {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.includes('platform_configuration_revisions')) return { rows: [{ config: this.config }] };
    if (query.sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    throw new Error(`Unsupported fixture SQL: ${query.sql}`);
  }
  async transaction<T>(callback: (tx: Database) => Promise<T>): Promise<T> {
    const snapshot = new Map([...this.tables].map(([table, rows]) => [table, structuredClone(rows)]));
    try { return await callback(this.db); }
    catch (error) { this.tables.clear(); for (const [table, rows] of snapshot) this.tables.set(table, rows); throw error; }
  }
}

class Query implements PromiseLike<Row[]> {
  private condition?: SQL;
  private patch: Row = {};
  private inserted: Row[] = [];
  private rowLimit = Infinity;
  private sort?: SQL;
  private result?: Promise<Row[]>;
  private conflictColumns: { name: string }[] = [];
  constructor(private readonly fixture: ProjectionDatabaseFixture, private readonly operation: string, private table?: Table) {}
  from(table: Table) { this.table = table; return this; }
  where(condition: SQL) { this.condition = condition; return this; }
  limit(count: number) { this.rowLimit = count; return this; }
  orderBy(sort: SQL) { this.sort = sort; return this; }
  for() { return this; }
  set(patch: Row) { this.patch = patch; return this; }
  values(rows: Row | Row[]) { this.inserted = Array.isArray(rows) ? rows : [rows]; return this; }
  onConflictDoNothing(options: { target?: { name: string } | { name: string }[] } = {}) {
    this.conflictColumns = options.target ? Array.isArray(options.target) ? options.target : [options.target] : [];
    return this;
  }
  returning() { return this; }
  then<TResult1 = Row[], TResult2 = never>(resolve?: ((rows: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    this.result ??= Promise.resolve().then(() => this.execute());
    return this.result.then(resolve, reject);
  }
  private execute(): Row[] {
    if (!this.table) throw new Error('fixture table missing');
    const table = this.table;
    const columns = getTableColumns(table);
    const key = (name: string) => Object.entries(columns).find(([, column]) => column.name === name)?.[0] ?? name;
    let rows = this.fixture.rows(table);
    if (this.operation === 'insert') {
      if (this.fixture.failInsertTable === table) throw new Error('FIXTURE_INSERT_FAILURE');
      const added = this.inserted.filter((row) => !this.conflictColumns.length || !rows.some((existing) => this.conflictColumns.every((column) => existing[key(column.name)] === row[key(column.name)])));
      this.fixture.tables.set(table, [...rows, ...added]);
      return added;
    }
    if (this.condition) {
      const query = dialect.sqlToQuery(this.condition);
      const checks: Array<(row: Row) => boolean> = [];
      let remainder = query.sql.replace(/"[^"]+"\."([^"]+)"\s+(=|<)\s+\$(\d+)/gu, (_match, name: string, operator: string, slot: string) => {
        const value = query.params[Number(slot) - 1];
        checks.push((row) => operator === '=' ? row[key(name)] === value : row[key(name)] != null && Number(row[key(name)]) < Number(value));
        return '';
      });
      remainder = remainder.replace(/"[^"]+"\."([^"]+)"\s+in\s+\(([^)]+)\)/giu, (_match, name: string, slots: string) => {
        const values = [...slots.matchAll(/\$(\d+)/gu)].map((match) => query.params[Number(match[1]) - 1]);
        checks.push((row) => values.includes(row[key(name)]));
        return '';
      });
      if (remainder.replace(/[()\s]/gu, '').replace(/and/gu, '')) throw new Error(`Unsupported fixture predicate: ${query.sql}`);
      rows = rows.filter((row) => checks.every((check) => check(row)));
    }
    if (this.operation === 'update') { for (const row of rows) Object.assign(row, this.patch); return rows; }
    if (this.sort) {
      const order = dialect.sqlToQuery(this.sort).sql;
      const field = key(order.match(/\."([^"]+)"/u)?.[1] ?? 'created_at');
      const sign = order.includes('desc') ? -1 : 1;
      rows = [...rows].sort((a, b) => sign * (Number(a[field]) - Number(b[field])));
    }
    return rows.slice(0, this.rowLimit);
  }
}
