/**
 * 纯 CSS 绘制的「桌面 AI 陪伴机器人」插画，与参考稿 `首页.png` 的项目图一致。
 * 不依赖任何图片资源；`compact` 用于列表/卡片内的小尺寸版本。
 */
export function ProjectVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? 'project-visual is-compact' : 'project-visual'}
      role="img"
      aria-label="桌面 AI 陪伴机器人项目模型"
    >
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
