import { runTeamRuntimeWorker } from './team-runtime-worker';

// This service consumes projection requests only, leaving teaching delegates alone.
runTeamRuntimeWorker({ ...process.env, QITU_TEAM_RUNTIME_PROJECTION_ONLY: 'true' }).catch(() => {
  console.error('[qitu-projection-worker] startup failed');
  process.exitCode = 1;
});
