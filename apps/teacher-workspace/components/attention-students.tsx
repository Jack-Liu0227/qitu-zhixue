import Link from 'next/link';
import { Avatar } from '@qitu/ui';
import type { TeacherStudentRow } from '@qitu/contracts';
import { ArrowRightIcon, CheckCircleIcon } from './icons';

/** Only the already-authorized teacher projection is rendered here. */
export function AttentionStudents({ students, available = true }: { students: TeacherStudentRow[]; available?: boolean }) {
  if (!available) return <div className="qtx-attention-empty"><strong>关注提醒暂未接入</strong><p>可进入学生列表查看已有项目与授权证据。</p></div>;
  return <div className="qtx-attention-list">
    {students.length === 0 ? <div className="qtx-attention-empty"><CheckCircleIcon size={26} /><strong>当前没有需要关注的学生</strong><p>有新的学习停滞或待处理问题时，会显示在这里。</p></div> : students.map((student) => <article className="qtx-attention-student" key={student.studentId}>
      <div className="qtx-attention-identity"><span className="qtx-avatar" aria-hidden="true"><Avatar name={student.displayName} /></span><div><strong>{student.displayName}</strong><span>{student.gradeLabel ?? '年级未填写'}</span></div></div>
      <div className="qtx-attention-project"><span className="qtx-attention-caption">当前探究项目</span><strong>{student.currentProjectTitle ?? '暂无进行中的项目'}</strong><div className="qtx-attention-reasons">{student.stuck ? <span className="qtx-badge qtx-badge-amber">学习进度待跟进</span> : null}{student.attentionCount > 0 ? <span className="qtx-badge qtx-badge-rose">{student.attentionCount} 个待处理问题</span> : null}{student.guardianCount === 0 ? <span className="qtx-badge qtx-badge-slate">尚无监护人协同</span> : null}</div></div>
      <dl className="qtx-attention-metrics"><div><dt>活跃天数</dt><dd>{student.activeDays}<small> 天</small></dd></div><div><dt>本周任务</dt><dd>{student.weeklyTasks}<small> 个</small></dd></div></dl>
      <Link href={`/students/${encodeURIComponent(student.studentId)}`} className="qtx-btn qtx-btn-ghost-blue" aria-label={`查看${student.displayName}的学情`}>查看学情 <ArrowRightIcon size={14} /></Link>
    </article>)}
  </div>;
}
