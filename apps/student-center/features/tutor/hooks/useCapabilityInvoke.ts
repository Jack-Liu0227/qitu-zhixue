'use client';

import { useCallback, useRef, useState } from 'react';
import type { PedagogicMove } from '@qitu/contracts';
import { createIdempotencyKey } from '../idempotency';

/**
 * Wraps a capability invocation with a stable, per-move idempotency key.
 *
 * If the tile is double-clicked the second call is ignored while one is in
 * flight, and a failed attempt reuses the SAME key on retry, so the server can
 * collapse duplicates instead of producing two turns. The key map is in memory
 * only.
 */
export function useCapabilityInvoke(
  invoke: (move: PedagogicMove, idempotencyKey: string) => Promise<void>,
) {
  const [pendingMove, setPendingMove] = useState<PedagogicMove | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keysRef = useRef<Partial<Record<PedagogicMove, string>>>({});
  const pendingRef = useRef(false);

  const invokeMove = useCallback(
    async (move: PedagogicMove) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPendingMove(move);
      setError(null);
      const key = keysRef.current[move] ?? createIdempotencyKey();
      keysRef.current[move] = key;
      try {
        await invoke(move, key);
        delete keysRef.current[move];
      } catch {
        setError('这一步没有发出去，可以再试一次。');
      } finally {
        pendingRef.current = false;
        setPendingMove(null);
      }
    },
    [invoke],
  );

  return { invokeMove, pendingMove, error };
}
