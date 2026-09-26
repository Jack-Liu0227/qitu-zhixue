import { projectStages } from './data';

export function StageTimeline({ detailed = false }: { detailed?: boolean }) {
  return (
    <ol className={detailed ? 'parent-stage-timeline is-detailed' : 'parent-stage-timeline'} aria-label="项目五阶段进度">
      {projectStages.map((stage, index) => (
        <li className={`is-${stage.status}`} key={stage.label}>
          <div className="parent-stage-track" aria-hidden="true">
            <span>{stage.status === 'done' ? '✓' : index + 1}</span>
          </div>
          <div className="parent-stage-copy">
            <strong>{stage.label}</strong>
            <small>{stage.detail}</small>
            {detailed && stage.status === 'current' ? <p>正在完成距离感应与灯光反馈的联调</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
