import type { TutorLearningSource } from '@qitu/contracts';

export function LearningSources({ sources }: { sources: readonly TutorLearningSource[] }) {
  return <ul className="qitu-learning-sources">{sources.map(source => <li key={source.sourceRef}>{source.title}</li>)}</ul>;
}

export function LearningResourceCard({ title, summary, sources, disabled, onRead }: {
  title: string; summary: string; sources: readonly TutorLearningSource[]; disabled: boolean;
  onRead?: (label: string, text: string) => void;
}) {
  return <section className="qitu-learning-resource">
    <span className="qitu-quiz-badge">推荐资料</span><h4>{title}</h4><p>{summary}</p>
    <LearningSources sources={sources} />
    <button type="button" className="qitu-button qitu-button-ghost" disabled={disabled || !onRead}
      onClick={() => onRead?.('和导师一起读', `请重新检索并核验这些资料的当前权限：${sources.map(source => source.title).join('、')}。围绕本课目标带我读一小段，再问一个观察问题；无法读取时请明确说明。`)}>和导师一起读</button>
  </section>;
}
