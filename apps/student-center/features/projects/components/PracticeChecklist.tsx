'use client';

import { SectionCard } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { TaskList } from './TaskList';
import type { TaskView } from '../types';

export interface PracticeChecklistProps {
  tasks: TaskView[];
  /** 服务端门判定结果；锁定后客户端无任何解锁入口（验收 9）。 */
  locked: boolean;
  /** 锁定态「去理论学习」入口。 */
  theoryHref?: string;
  offline?: boolean;
  completingTaskId?: string | null;
  onCompleteTask?: (taskId: string) => void;
}

/** 实践清单；锁定态由服务端字段驱动，客户端不可绕过。 */
export function PracticeChecklist({
  tasks,
  locked,
  theoryHref,
  offline = false,
  completingTaskId = null,
  onCompleteTask,
}: PracticeChecklistProps) {
  if (locked) {
    return (
      <SectionCard title="实践清单">
        <div className="qitu-practice-locked" role="note">
          <h3>理论未掌握，实践已锁定</h3>
          <p>先完成理论校验并通过，实践阶段会自动解锁。</p>
          {theoryHref ? (
            <StudentLink className="qitu-button" href={theoryHref}>
              去理论学习
            </StudentLink>
          ) : null}
        </div>
      </SectionCard>
    );
  }

  if (tasks.length === 0) {
    return (
      <SectionCard title="实践清单">
        <p className="qitu-form-hint">等待阶段解锁，暂时没有实践任务。</p>
      </SectionCard>
    );
  }

  return (
    <TaskList
      title="实践清单"
      tasks={tasks}
      readOnly={offline}
      completingTaskId={completingTaskId}
      onComplete={onCompleteTask}
    />
  );
}
