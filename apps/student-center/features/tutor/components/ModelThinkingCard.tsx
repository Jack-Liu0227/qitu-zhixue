'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './TutorStream.module.css';

interface ModelThinkingCardProps {
  /** The model's inner reasoning scratchpad text */
  content: string;
  /** Whether reasoning is completed (closed = true) or streaming (closed = false) */
  closed: boolean;
}

/**
 * Collapsible card for model reasoning (<think> scratchpad), referencing DeepTutor ModelThinkingCard.
 * Default-open while streaming, auto-collapses once finished.
 */
export function ModelThinkingCard({ content, closed }: ModelThinkingCardProps) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const open = userToggled !== null ? userToggled : !closed;

  useEffect(() => {
    const el = detailsRef.current;
    if (el && el.open !== open) {
      el.open = open;
    }
  }, [open]);

  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open;
    if (next !== open) {
      setUserToggled(next);
    }
  };

  const hasBody = content.trim().length > 0;

  return (
    <details ref={detailsRef} onToggle={handleToggle} className={styles.thinkingCard}>
      <summary className={styles.thinkingSummary}>
        <span className={styles.thinkingCaret} aria-hidden="true">
          ▶
        </span>
        <span className={styles.thinkingBrainIcon} aria-hidden="true">
          🧠
        </span>
        <span className={styles.thinkingTitle}>模型深度思考过程</span>
        {!closed && <span className={styles.thinkingSpinner} aria-hidden="true" />}
      </summary>
      <div className={styles.thinkingBody}>
        {hasBody ? (
          <pre className={styles.thinkingContent}>{content}</pre>
        ) : (
          <div className={styles.thinkingPlaceholder}>正在组织启发性引导思路...</div>
        )}
      </div>
    </details>
  );
}
