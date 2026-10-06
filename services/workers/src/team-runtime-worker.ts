import { closeDb, createDb } from '@qitu/database';
import { PostgresTeamProjectionSource } from './team-runtime-projection-source';
import { PostgresTeamMailboxSource, type TeamMailboxJob } from './team-runtime-mailbox-source';
import { createTeamAgentExecutor } from './team-runtime-executor';

export type TeamMailboxExecutor = (job: TeamMailboxJob) => Promise<Record<string, unknown>>;

export interface TeamRuntimeWorkerOutcome {
  status: 'idle' | 'published' | 'retry';
  projections?: number;
  taskId?: string | null;
}

export async function runTeamMailboxOnce(
  db: ReturnType<typeof createDb>,
  executor: TeamMailboxExecutor,
  options: NodeJS.ProcessEnv = process.env,
): Promise<TeamRuntimeWorkerOutcome> {
  const source = new PostgresTeamMailboxSource(db, Number(options.QITU_TEAM_RUNTIME_MAX_ATTEMPTS ?? 3));
  const job = await source.claim(options.QITU_TEAM_RUNTIME_AGENT_ID?.trim() || undefined);
  if (!job) return { status: 'idle' };
  try {
    const output = await executor(job);
    const acknowledged = await source.complete(job, output);
    return acknowledged
      ? { status: 'published', taskId: job.task?.id ?? null }
      : { status: 'retry', taskId: job.task?.id ?? null };
  } catch (error) {
    await source.retry(job, error);
    return { status: 'retry', taskId: job.task?.id ?? null };
  }
}

export async function runTeamRuntimeOnce(
  db: ReturnType<typeof createDb>,
  options: NodeJS.ProcessEnv = process.env,
  executor?: TeamMailboxExecutor,
): Promise<TeamRuntimeWorkerOutcome> {
  const mailbox = await runTeamMailboxOnce(db, executor ?? createTeamAgentExecutor(db, { env: options }), options);
  if (mailbox.status !== 'idle') return mailbox;
  const source = new PostgresTeamProjectionSource(db, Number(options.QITU_TEAM_RUNTIME_MAX_ATTEMPTS ?? 5));
  const job = await source.claim();
  if (!job) return { status: 'idle' };
  try {
    const projections = await source.project(job);
    await source.complete(job);
    return { status: 'published', projections };
  } catch (error) {
    await source.retry(job, error);
    return { status: 'retry' };
  }
}

export async function runTeamRuntimeWorker(options = process.env, args = process.argv.slice(2)): Promise<void> {
  if (!options.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const db = createDb(options.DATABASE_URL);
  try {
    if ((args[0] ?? 'consume') === 'once') {
      console.log(JSON.stringify(await runTeamRuntimeOnce(db, options)));
      return;
    }
    if ((args[0] ?? 'consume') !== 'consume') return;
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    while (!stopping) {
      const result = await runTeamRuntimeOnce(db, options);
      if (result.status !== 'published') await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await closeDb(db);
  }
}
