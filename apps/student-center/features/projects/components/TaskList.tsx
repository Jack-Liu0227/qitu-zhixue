'use client';

import { SectionCard, StageBadge } from '@qitu/ui';
import { taskBadgeTone } from '../lib/stage';
import type { TaskView } from '../types';

export interface TaskListProps {
  title?: string;
  tasks: TaskView[];
  readOnly?: boolean;
  completingTaskId?: string | null;
  onComplete?: (taskId: string) => void;
  focusedTaskId?: string | null;
}

function taskLabel(status: TaskView['status']): string {
  switch (status) {
    case 'done':
      return '已完成';
    case 'doing':
      return '进行中';
    case 'locked':
      return '已锁定';
    default:
      return '待开始';
  }
}

/** 当前阶段任务；完成动作走带幂等键的写接口（父级注入）。 */
export function TaskList({
  title = '当前阶段任务',
  tasks,
  readOnly = false,
  completingTaskId = null,
  onComplete,
  focusedTaskId = null,
}: TaskListProps) {
  return (
    <SectionCard title={title}>
      <ul className="qitu-task-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {tasks.map((task) => {
          const locked = task.status === 'locked';
          const done = task.status === 'done';
          return (
            <li
              key={task.id}
              className={task.id === focusedTaskId ? 'qitu-task-item is-focused' : 'qitu-task-item'}
              id={task.id === focusedTaskId ? `task-${task.id}` : undefined}
            >
              <div className="qitu-task-item-main">
                <h4>{task.title}</h4>
                <p>{task.description}</p>
                {task.isTodayFocus ? <span className="qitu-task-focus">今日重点</span> : null}
              </div>
              <StageBadge label={taskLabel(task.status)} tone={taskBadgeTone(task.status)} />
              {onComplete ? (
                <button
                  type="button"
                  className="qitu-button"
                  disabled={readOnly || locked || done || completingTaskId === task.id}
                  onClick={() => onComplete(task.id)}
                >
                  {done ? '已完成' : completingTaskId === task.id ? '提交中…' : '标记完成'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
