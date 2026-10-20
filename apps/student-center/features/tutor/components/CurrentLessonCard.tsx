import type { TutorProjectContext } from '@qitu/contracts';

export function CurrentLessonCard({ lesson }: { lesson: TutorProjectContext['lesson'] }) {
  return (
    <section className="qitu-tutor-phase-tree qitu-tutor-current-lesson" aria-label="课时安排">
      <div className="qitu-tutor-phase-tree-heading">
        <div>
          <span>LESSON PLAN</span>
          <h3>课时安排</h3>
        </div>
        {lesson ? <span>{lesson.lessonIndex}/{lesson.lessonCount} 课时</span> : null}
      </div>
      {lesson ? (
        <div className="qitu-tutor-phase-details">
          <strong>第 {lesson.lessonIndex} 课时：{lesson.title}</strong>
          <p>建议从当前未掌握目标对应的课时继续学习。</p>
          <p>课时进度不会由一次答题自动完成；掌握门禁仍由服务端核验。</p>
        </div>
      ) : (
        <div className="qitu-tutor-phase-details">
          <strong>暂无课时安排</strong>
          <p>服务端尚未返回此项目的冻结学习计划。</p>
        </div>
      )}
    </section>
  );
}
