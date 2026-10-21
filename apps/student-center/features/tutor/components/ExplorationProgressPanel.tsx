'use client';

import type { TutorProjectContext } from '@qitu/contracts';

export function ExplorationProgressPanel({ context, disabled, onConfirm }: {
  context: TutorProjectContext | null;
  disabled: boolean;
  onConfirm: (goal: string, interest: string, templateVersionId: string) => void;
}) {
  const meta = context?.exploration;
  const version = meta?.templateVersionId;
  return <section className="qitu-tutor-state-panel qitu-exploration-progress" aria-label="探索准备进度">
    <strong>{version ? '模板项目 · 立项前准备' : '自由探索 · 整理方向'}</strong>
    {version ? <h3>{meta.title}</h3> : null}
    {meta?.drivingQuestion ? <p>{meta.drivingQuestion}</p> : null}
    <ol><li>了解挑战与预期作品</li><li>和导师梳理自己的问题</li><li>确认选择，进入课时学习</li></ol>
    <p>尚未创建正式项目。确认后将显示实际课时、当前任务和证据进度。</p>
    {version ? <button type="button" className="qitu-button qitu-button-primary"
      disabled={disabled || meta.handoff !== 'ready'}
      onClick={() => onConfirm(meta.title.slice(0,120), meta.title.slice(0,24), version)}>确认并开始这个项目</button> : null}
    {version && meta.handoff !== 'ready' ? <p role="status">导师配置尚未就绪，请联系老师检查模板配置。</p> : null}
  </section>;
}
