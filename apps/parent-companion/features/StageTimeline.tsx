/**
 * 横向阶段时间轴，与参考稿 `学习进展.png` 的「版本成长」一致。
 * 接收任意数量的步骤（父端用它渲染服务端返回的版本列表），
 * 每一列的右侧连接线会在 `done` 步骤处着色为已完成色。
 */
export type StageTimelineStep = {
  id: string;
  label: string;
  detail: string;
  status: 'done' | 'current' | 'upcoming';
  /** `detailed` 模式下，当前步骤下方补充展示的说明。 */
  note?: string;
};

export function StageTimeline({
  steps,
  detailed = false,
}: {
  steps: StageTimelineStep[];
  detailed?: boolean;
}) {
  return (
    <ol
      className={detailed ? 'parent-stage-timeline is-detailed' : 'parent-stage-timeline'}
      aria-label="版本成长"
    >
      {steps.map((step, index) => (
        <li className={`is-${step.status}`} key={step.id}>
          <div className="parent-stage-track" aria-hidden="true">
            <span>{step.status === 'done' ? '✓' : index + 1}</span>
          </div>
          <div className="parent-stage-copy">
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
            {detailed && step.status === 'current' && step.note ? <p>{step.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
