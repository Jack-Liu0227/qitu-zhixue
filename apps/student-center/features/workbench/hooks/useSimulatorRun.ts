'use client';

import { useCallback, useState } from 'react';
import type { WorkbenchDataSource } from '../data/workbenchDataSource';
import type { SimulatorTranscriptEntry } from '../types/workbench';

export interface SimulatorRunState {
  runId: string | null;
  transcript: SimulatorTranscriptEntry[];
  sending: boolean;
  error: string | null;
  send: (input: string) => Promise<void>;
  /** Reset = drop the current run id client-side; the next send starts a new run. */
  reset: () => void;
}

/**
 * Simulator runs are persisted for replay/iteration but are NOT project
 * evidence. The transcript lives in memory only; it is never written to the
 * offline draft buffer.
 */
export function useSimulatorRun(args: {
  projectId: string;
  dataSource: WorkbenchDataSource;
  draftRevision: number;
  enabled: boolean;
}): SimulatorRunState {
  const { projectId, dataSource, draftRevision, enabled } = args;
  const [runId, setRunId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<SimulatorTranscriptEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (input: string) => {
      if (!enabled || input.trim() === '') return;
      setSending(true);
      setError(null);
      try {
        const run = await dataSource.runSimulator(projectId, input, draftRevision);
        setRunId(run.id);
        setTranscript(run.transcript);
      } catch {
        setError('SIMULATOR_RUN_FAILED');
      } finally {
        setSending(false);
      }
    },
    [dataSource, draftRevision, enabled, projectId],
  );

  const reset = useCallback(() => {
    setRunId(null);
    setTranscript([]);
    setError(null);
  }, []);

  return { runId, transcript, sending, error, send, reset };
}
