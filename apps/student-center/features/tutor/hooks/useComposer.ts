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
export interface AttachmentDraft {
  id: string;
  name: string;
  type: 'image' | 'file';
  url: string;
  sizeText?: string;
}

export function useComposer() {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const pendingKeyRef = useRef<string | null>(null);

  const addAttachments = useCallback((newItems: AttachmentDraft[]) => {
    setAttachments((prev) => [...prev, ...newItems]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    pendingKeyRef.current = null;
    setDraft('');
    setAttachments([]);
  }, []);

  const submit = useCallback(
    async (
      content: string,
      send: (text: string, idempotencyKey: string, attachments?: AttachmentDraft[]) => Promise<void>,
      customAttachments?: AttachmentDraft[],
    ) => {
      const text = content.trim();
      const currentAttachments = customAttachments ?? attachments;
      if ((text.length === 0 && currentAttachments.length === 0) || submitting) return;
      // Reuse the in-flight key so a retry after a dropped socket is idempotent.
      const key = pendingKeyRef.current ?? createIdempotencyKey();
      pendingKeyRef.current = key;
      setSubmitting(true);
      try {
        await send(text, key, currentAttachments);
        pendingKeyRef.current = null;
        setDraft('');
        setAttachments([]);
      } catch {
        // Keep the draft AND the same key for a safe manual retry.
      } finally {
        setSubmitting(false);
      }
    },
    [attachments, submitting],
  );

  return {
    draft,
    setDraft,
    attachments,
    setAttachments,
    addAttachments,
    removeAttachment,
    submitting,
    submit,
    clear,
  };
}
