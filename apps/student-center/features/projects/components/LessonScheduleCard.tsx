import { SectionCard } from '@qitu/ui';
import type { LessonScheduleView } from '../types';

const BLOCK_LABELS = {
  review: '复习',
  theory: '理论学习',
  check: '理解检查',
  practice: '实践',
  reflect: '反思',
} as const;

/** Student-facing course spine: one lesson per card, without exposing stage taxonomy. */
export function LessonScheduleCard({ schedule }: { schedule: LessonScheduleView | null }) {
  return (
    <SectionCard title="课时安排">
      {!schedule ? (
        <p className="qitu-form-hint" role="status">课时安排正在生成，稍后刷新即可查看。</p>
      ) : (
        <>
          <p className="qitu-form-hint">
            共 {schedule.lessonCount} 课时 · 每课时 {schedule.lessonMinutes} 分钟
          </p>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {schedule.lessons.map((lesson) => (
              <li key={lesson.lessonIndex} style={{ padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <strong style={{ minWidth: 64 }}>第 {lesson.lessonIndex} 课时</strong>
                  <span>{lesson.title}</span>
                </div>
                {lesson.blocks.length > 0 ? (
                  <ul style={{ listStyle: 'none', padding: '6px 0 0 74px', margin: 0, color: '#64748b', fontSize: 13 }}>
                    {lesson.blocks.map((block, index) => (
                      <li key={`${lesson.lessonIndex}-${index}`}>
                        {block.title || BLOCK_LABELS[block.kind]} · {block.minutes} 分钟
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </SectionCard>
  );
}
