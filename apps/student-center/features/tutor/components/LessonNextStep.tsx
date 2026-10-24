import type { TutorProjectContext } from '@qitu/contracts';

/** Navigation to existing owner-backed controls; never infers completion from chat. */
export function LessonNextStep({ lesson, disabled, onOpenRecords, onExplain }: {
  lesson: NonNullable<TutorProjectContext['lesson']>;
  disabled: boolean;
  onOpenRecords?(): void;
  onExplain?(message: string): void;
}) {
  if (lesson.status !== 'current') return null;
  const activity = lesson.currentActivity;
  if (activity?.evidence === 'teaching_delivery' || activity?.evidence === 'mastery') return null;
  const observation = activity?.evidence === 'experiment_observation';
  const artifact = activity?.evidence === 'submitted_artifact';
  const title = !activity ? '核对评价，申请完成本课'
    : observation ? '完成本课实验并保存观察'
      : artifact ? '提交本课作品并申请审核'
        : activity.kind === 'reflect' ? '保存本活动的表达与反思' : '保存本活动的回答与依据';
  return <section className="qitu-lesson-assessment-card" aria-label="本课下一步">
    <strong>第 {lesson.lessonIndex} 课 · {title}</strong>
    {activity ? <p>{activity.guidance}</p> : null}
    <p>{!activity ? '请查看本课评价与完成条件，选择已保存的证据后申请完成。下一课以服务端确认结果为准。'
      : observation ? '在当前实验卡中完成预测、运行和保存观察。模拟结果需取得保存回执；仅调整参数不会完成活动。'
        : artifact ? '在学习记录中提交作品正文并申请审核，依据反馈修订。审核通过后还需发布已审核版本。'
          : '先跟随导师完成当前活动，再保存自己的表达。对话中的回答不会自动保存为本活动的学习记录；需要班主任评价时，请等待老师处理。'}</p>
    {activity && !observation && onExplain ? <button type="button" className="qitu-button qitu-button-ghost" disabled={disabled}
      onClick={() => onExplain('请按照当前课时和当前活动继续指导我，结合已有学习记录说明这一步要做什么。需要新概念时先讲解并展示图示，再让我尝试；不要替我提交学习记录。')}>继续当前活动</button> : null}
    {observation && onExplain ? <button type="button" className="qitu-button qitu-button-primary" disabled={disabled}
      onClick={() => onExplain('请按照当前课时的探究任务，恢复已有实验或准备本活动允许的实验，指导我完成预测、运行和保存观察。')}>继续本课实验</button> : null}
    {onOpenRecords ? <button type="button" className="qitu-button qitu-button-primary" disabled={disabled}
      onClick={onOpenRecords}>打开本课记录与评价</button> : null}
  </section>;
}
