import { SectionCard, TagChips } from '@qitu/ui';
import type { TutorCurrentTask as CurrentTaskModel } from '../types';

/**
 * Left-column current task card. DISPLAY ONLY — read from the server's
 * `/projects/:id/tasks` projection; the client never completes or mutates it.
 */
export function CurrentTask({ task }: { task: CurrentTaskModel | null }) {
  return (
    <SectionCard title="当前任务">
      {task === null ? (
        <p className="qitu-tutor-muted">这个阶段暂时没有安排任务。</p>
      ) : (
        <div className="qitu-tutor-task">
          <h3 className="qitu-tutor-task-title">{task.title}</h3>
          {task.detail ? <p className="qitu-tutor-task-detail">{task.detail}</p> : null}
          {task.isTodayFocus ? <TagChips tags={['今日重点']} tone="attention" /> : null}
        </div>
      )}
    </SectionCard>
  );
}
