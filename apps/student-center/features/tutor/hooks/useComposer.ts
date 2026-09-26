'use client';

import { useCallback, useRef, useState } from 'react';
import { createIdempotencyKey } from '../idempotency';

/**
 * Composer draft + idempotency key management.
 *
 * The draft and the pending key live in memory only (React state / refs). They
 * are never written to `localStorage`/`sessionStorage`/IndexedDB: the draft can
 * contain a minor's raw words, and the transcript must be recoverable only from
 * the server journal.
 */
export function useComposer() {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pendingKeyRef = useRef<string | null>(null);

  const submit = useCallback(
    async (content: string, send: (text: string, idempotencyKey: string) => Promise<void>) => {
      const text = content.trim();
      if (text.length === 0 || submitting) return;
      // Reuse the in-flight key so a retry after a dropped socket is idempotent.
      const key = pendingKeyRef.current ?? createIdempotencyKey();
      pendingKeyRef.current = key;
      setSubmitting(true);
      try {
        await send(text, key);
        pendingKeyRef.current = null;
        setDraft('');
      } catch {
        // Keep the draft AND the same key for a safe manual retry.
      } finally {
        setSubmitting(false);
      }
    },
    [submitting],
  );

  const clear = useCallback(() => {
    pendingKeyRef.current = null;
    setDraft('');
  }, []);

  return { draft, setDraft, submitting, submit, clear };
}
