import { RobotMascot } from '@qitu/ui';

export function TutorHeader() {
  return (
    <header className="qitu-tutor-header">
      <div className="qitu-tutor-header-mascot" aria-hidden="true">
        <RobotMascot size={58} mood="thinking" />
      </div>
      <div>
        <p className="qitu-tutor-eyebrow">启途学习伙伴</p>
        <h1>AI搭档</h1>
        <p className="qitu-tutor-header-subtitle">做你最懂你的 AI 创作伙伴</p>
      </div>
      <div className="qitu-tutor-header-status" role="status">
        <span className="qitu-tutor-status-dot" aria-hidden="true" />
        会记住你的学习进展
      </div>
    </header>
  );
}
