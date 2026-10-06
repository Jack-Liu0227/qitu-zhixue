import { createDb, closeDb } from '@qitu/database';
import { GraphitiMasteryProvider } from './mastery-graph-provider';
import { PostgresMasteryProjectionSource } from './mastery-projection-source';
import { MasteryProjectionWorker } from './mastery-projection-worker';
import { runMemoryWorker } from './memory-worker';
import { runTeamRuntimeWorker } from './team-runtime-worker';

export async function runMasteryWorker(options = process.env, args = process.argv.slice(2)): Promise<void> {
  if (options.QITU_GRAPHITI_ENABLED !== 'true') {
    console.log('[qitu-workers] mastery graph projection disabled');
    return;
  }
  if (!options.DATABASE_URL || !options.QITU_GRAPHITI_URL || !options.QITU_GRAPHITI_TOKEN) {
    throw new Error('GRAPHITI_CONFIG_REQUIRED');
  }
  const db = createDb(options.DATABASE_URL);
  try {
    const graph = new GraphitiMasteryProvider({ baseUrl: options.QITU_GRAPHITI_URL, token: options.QITU_GRAPHITI_TOKEN });
    const worker = new MasteryProjectionWorker(new PostgresMasteryProjectionSource(db), graph);
    const command = args[0] ?? 'consume';
    const cursor = args[1] ?? null;
    if (command === 'rebuild') { console.log(JSON.stringify(await worker.rebuild(cursor))); return; }
    if (command === 'reconcile') { console.log(JSON.stringify(await worker.reconcile(cursor))); return; }
    if (command === 'once') { console.log(await worker.runOnce()); return; }
    if (command !== 'consume') throw new Error('WORKER_COMMAND_INVALID');
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    while (!stopping) {
      const outcome = await worker.runOnce();
      if (outcome === 'idle' || outcome === 'retry') await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await closeDb(db);
  }
}

export async function runAllWorkers(options = process.env, args = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? 'consume';
  if (command === 'once') {
    await Promise.all([runOptionalMasteryWorker(options, args), runMemoryWorker(options, args), runTeamRuntimeWorker(options, args)]);
    return;
  }
  if (command === 'rebuild' || command === 'reconcile') {
    await runMasteryWorker(options, args);
    return;
  }
  await Promise.all([runOptionalMasteryWorker(options, args), runMemoryWorker(options, args), runTeamRuntimeWorker(options, args)]);
}

/** Graphiti is an optional projection; mailbox and memory workers must start with only the database. */
async function runOptionalMasteryWorker(options: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  if (options.QITU_GRAPHITI_ENABLED !== 'true') return;
  if (!options.DATABASE_URL || !options.QITU_GRAPHITI_URL || !options.QITU_GRAPHITI_TOKEN) {
    console.log('[qitu-workers] mastery graph projection skipped: Graphiti configuration is incomplete');
    return;
  }
  await runMasteryWorker(options, args);
}

if (!process.env.NODE_TEST_CONTEXT) runAllWorkers().then(() => {
  if ((process.argv[2] ?? 'consume') !== 'consume') process.exit(0);
}).catch(() => {
  console.error('[qitu-workers] worker startup failed; check database and optional index configuration');
  process.exit(1);
});
