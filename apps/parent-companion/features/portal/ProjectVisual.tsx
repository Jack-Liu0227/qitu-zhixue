export function ProjectVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'project-visual is-compact' : 'project-visual'} role="img" aria-label="桌面 AI 陪伴机器人项目模型">
      <span className="project-visual-glow" />
      <span className="project-visual-desk" />
      <span className="project-robot-antenna" />
      <span className="project-robot-head">
        <i className="project-robot-eye left" />
        <i className="project-robot-eye right" />
        <i className="project-robot-smile" />
      </span>
      <span className="project-robot-body">
        <i />
      </span>
      <span className="project-robot-shadow" />
    </div>
  );
}
