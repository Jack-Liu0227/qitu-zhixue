import type { TutorToolCall } from '@qitu/contracts';
import styles from './TutorStream.module.css';

/**
 * One step of the tutor's execution, rendered as a student-visible row.
 *
 * WHY THIS IS IN THE UI AT ALL: 「先读项目上下文、再查掌握度、再决定提示等级、
 * 最后做答案泄露校验」 are real decisions. Showing them as discrete, ordered
 * steps is what makes the AI's help auditable — the student (and later a
 * parent or teacher) can see WHAT it looked at before it spoke, instead of
 * trusting a wall of prose. The result text is the server's short,
 * student-safe summary; nothing is composed client-side.
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
      <span>
        <span className={styles.label}>{call.label}</span>
        {call.result !== undefined && call.result.length > 0 ? (
          <span className={styles.result}>{call.result}</span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * A run of consecutive tool calls, presented as one 「执行过程」 panel.
 *
 * `aria-live="polite"` is inherited from the thread container, so each new step
 * and each settled result is announced once — a screen-reader user hears the
 * same progression a sighted user watches.
 */
export function ToolCallTimeline({ calls }: { calls: TutorToolCall[] }) {
  if (calls.length === 0) return null;
  const running = calls.some((call) => call.status === 'running');
  return (
    <ol className={styles.timeline} data-testid="tutor-tool-timeline">
      <li className={styles.timelineHeader} aria-hidden="true">
        <span className={styles.timelineHeaderDot} />
        {running ? 'AI搭档正在处理' : 'AI搭档的执行过程'}
      </li>
      {calls.map((call) => (
        <ToolCallStep key={call.callId} call={call} />
      ))}
    </ol>
  );
}

/** Blinking caret appended to the text block that is still streaming in. */
export function StreamCaret() {
  return <span className={styles.caret} aria-hidden="true" />;
}
