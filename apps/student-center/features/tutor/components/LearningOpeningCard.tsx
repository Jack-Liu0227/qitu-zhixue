import type { TutorOpeningBlock } from '@qitu/contracts';
import { MarkdownMathView } from './MarkdownMathView';
import styles from './LearningOpeningCard.module.css';

export function LearningOpeningCard({ block }: { block: TutorOpeningBlock }) {
  const label = block.mode === 'lesson' ? `第 ${block.lessonIndex} 课 / 共 ${block.lessonCount} 课`
    : block.mode === 'template' ? '项目挑战' : '灵感起点';
  return <section className={styles.card} aria-label={block.mode === 'lesson' ? '本课开场' : '探索开场'}>
    <div className={styles.heading}><div><span className={styles.badge}>{label}</span><h3>{block.title}</h3></div>
      <svg className={styles.waves} viewBox="0 0 150 90" fill="none" aria-hidden="true">
        <path d="M0 45C15 5 25 5 40 45S65 85 80 45 105 5 120 45 140 85 155 45" stroke="currentColor" strokeWidth="3" />
        <path d="M0 60C15 20 25 20 40 60S65 100 80 60 105 20 120 60 140 100 155 60" stroke="currentColor" strokeWidth="2" opacity=".3" />
        <circle cx="80" cy="45" r="6" fill="currentColor" />
      </svg>
    </div>
    <div className={styles.scenario}><MarkdownMathView content={block.scenario} /></div>
    {block.goal ? <div className={styles.goal}><span>本课目标</span><p>{block.goal}</p></div> : null}
    <div className={styles.prompt}><span>先想一想</span><MarkdownMathView content={block.prompt} /></div>
    <p className={styles.note}>{block.mode === 'lesson' ? '从你的观察出发。导师会结合你的回答，安排图示、例子或下一步探究。' : '可以选择一个方向，也可以直接说说你的想法。'}</p>
  </section>;
}
