'use client';

import { useState } from 'react';
import type { TutorToolCall } from '@qitu/contracts';
import styles from './TutorStream.module.css';

/**
 * Single step of tool execution.
 */
export function ToolCallStep({ call }: { call: TutorToolCall }) {
  const statusText =
    call.status === 'running' ? '正在执行' : call.status === 'done' ? '已完成' : '执行失败';
  return (
    <li className={call.status === 'running' ? `${styles.step} ${styles.stepRunning}` : styles.step}>
      <span className={styles.marker} role="img" aria-label={statusText}>
        {call.status === 'running' ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {call.status === 'done' ? (
          <span className={styles.check} aria-hidden="true">
            ✓
          </span>
        ) : null}
        {call.status === 'error' ? (
          <span className={styles.error} aria-hidden="true">
            !
          </span>
        ) : null}
      </span>
      <span className={styles.stepContent}>
        <span className={styles.label}>{call.label}</span>
        {call.result !== undefined && call.result.length > 0 ? (
          <span className={styles.result}>{call.result}</span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * Collapsible Process Fold referencing DeepTutor ProcessFold & ActivityFold.
 */
export function ToolCallTimeline({ calls }: { calls: TutorToolCall[] }) {
  if (calls.length === 0) return null;
  const running = calls.some((call) => call.status === 'running');
  // Auto-expand when running, fold when settled; user click overrides
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? running;

  return (
    <div className={styles.toolFoldContainer} data-testid="tutor-tool-timeline">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className={styles.toolFoldButton}
      >
        <span className={running ? `${styles.toolStatusDot} ${styles.dotRunning}` : styles.toolStatusDot} />
        <span className={styles.toolFoldTitle}>
          {running ? 'AI搭档正在执行工具...' : `${calls.length} 次工具与环境调用`}
        </span>
        <span className={`${styles.toolFoldCaret} ${open ? styles.caretRotated : ''}`} aria-hidden="true">
          ▶
        </span>
      </button>

      {open && (
        <ol className={styles.timeline}>
          {calls.map((call) => (
            <ToolCallStep key={call.callId} call={call} />
          ))}
        </ol>
      )}
    </div>
  );
}

/** Blinking caret appended to the text block that is still streaming in. */
export function StreamCaret() {
  return <span className={styles.caret} aria-hidden="true" />;
}
