import { createDb, closeDb, type Database } from '@qitu/database';
import { Mem0HttpIndex } from '@qitu/agent-memory/mem0';
import type { MemoryIndexPort } from '@qitu/agent-memory';
import { MemoryOutboxHandler } from './memory-outbox-handler';
import { PostgresMemoryRecordSource, memoryIndexConfig } from './memory-outbox-source';

class UnavailableMemoryIndex implements MemoryIndexPort {
  async reconcile(): Promise<string | null> { throw new Error('MEM0_NOT_CONFIGURED'); }
  async remove(): Promise<void> { throw new Error('MEM0_NOT_CONFIGURED'); }
  async recall(): Promise<never[]> { return []; }
}

export interface MemoryWorkerOutcome {
  status: 'idle' | 'published' | 'failed' | 'retry';
}

export async function runMemoryOnce(
  db: Database,
  options: NodeJS.ProcessEnv = process.env,
): Promise<MemoryWorkerOutcome> {
  const source = new PostgresMemoryRecordSource(db);
  const claimed = await source.claim();
  if (!claimed) return { status: 'idle' };
  const index = createMemoryIndex(options);
  const handler = new MemoryOutboxHandler(source, index);
  try {
    await handler.handle(claimed.payload);
    await source.complete(claimed.outboxId);
    return { status: 'published' };
  } catch (error) {
    const attempts = Number(options.QITU_MEMORY_MAX_ATTEMPTS ?? 5);
    await source.retry(claimed.outboxId, error, source.shouldFail(claimed.attempts) || (Number.isFinite(attempts) && claimed.attempts >= attempts));
    return { status: 'failed' };
  }
}

export async function runMemoryWorker(options = process.env, args = process.argv.slice(2)): Promise<void> {
  if (!options.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const db = createDb(options.DATABASE_URL);
  try {
    const command = args[0] ?? 'consume';
    if (command === 'once') {
      console.log(JSON.stringify(await runMemoryOnce(db, options)));
      return;
    }
    if (command !== 'consume') return;
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    while (!stopping) {
      const outcome = await runMemoryOnce(db, options);
      if (outcome.status === 'idle' || outcome.status === 'failed') await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await closeDb(db);
  }
}

function createMemoryIndex(options: NodeJS.ProcessEnv): MemoryIndexPort {
  const config = memoryIndexConfig(options);
  return config ? new Mem0HttpIndex(config) : new UnavailableMemoryIndex();
}
