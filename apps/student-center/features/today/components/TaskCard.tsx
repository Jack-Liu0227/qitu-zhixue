import { colors } from '@qitu/design-tokens';
import { TagChips } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';

import type { TodayTask } from '../types';

/**
 * Module-local task card. `@qitu/ui` does not export `TaskCard` yet (Wave 3
 * unavailable list). It only renders server-computed fields and, at most,
 * navigates via the server-provided `actionTarget` — task completion is owned
 * by the tasks API, never by this page.
 */
export function TaskCard({ task }: { task: TodayTask }) {
  return (
    <article
      className="qitu-task-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 12,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        background: '#FFFFFF',
      }}
    >
      {task.isTodayFocus ? <TagChips tags={['今日重点']} tone="attention" /> : null}
      <strong style={{ color: colors.heading }}>{task.title}</strong>
      <span style={{ color: colors.muted, fontSize: 13 }}>{task.description}</span>
      {task.actionTarget ? (
        <StudentLink href={task.actionTarget} style={{ fontSize: 14 }}>
          开始任务
        </StudentLink>
      ) : null}
    </article>
  );
}
