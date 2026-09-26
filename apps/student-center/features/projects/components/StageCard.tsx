import { StageBadge } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import type { ProjectStageView } from '../types';

export interface StageCardProps {
  view: ProjectStageView;
  /** 阶段入口 href；null 表示当前阶段没有可进入的子页面。 */
  href: string | null;
  /** 服务端判定为锁定（如理论未掌握时的实践）。锁定后不可在客户端绕过。 */
  locked?: boolean;
}

/** 单个阶段卡；阶段名逐字来自服务端模板（验收 8）。 */
export function StageCard({ view, href, locked = false }: StageCardProps) {
  const tone = view.status === 'done' ? 'done' : view.status === 'active' ? 'current' : 'locked';
  const content = (
    <>
      <StageBadge label={view.name} tone={locked ? 'locked' : tone} />
      <p className="qitu-stage-card-description">{view.description}</p>
      {locked ? (
        <p className="qitu-stage-card-locked">理论未掌握，实践已锁定</p>
      ) : view.status !== 'pending' && href ? (
        <span className="qitu-stage-card-enter">进入</span>
      ) : null}
    </>
  );

  if (locked || !href || view.status === 'pending') {
    return <li className="qitu-stage-card is-disabled">{content}</li>;
  }
  return (
    <li className="qitu-stage-card">
      <StudentLink href={href}>{content}</StudentLink>
    </li>
  );
}
