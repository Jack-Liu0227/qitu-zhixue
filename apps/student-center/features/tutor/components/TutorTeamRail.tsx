import { TeamStatusBadge, type TeamNodeStatus } from '@qitu/ui';

interface TutorTeamRailProps {
  streaming: boolean;
  ready: boolean;
  failed: boolean;
  offline: boolean;
}

/**
 * A student-safe Team projection. It intentionally exposes role-level status
 * only; mailbox payloads, prompts and other students' evidence stay server-side.
 */
export function TutorTeamRail({ streaming, ready, failed, offline }: TutorTeamRailProps) {
  const leaderStatus: TeamNodeStatus = offline
    ? 'offline'
    : failed
      ? 'failed'
      : streaming
        ? 'running'
        : ready
          ? 'ready'
          : 'waiting';
  return (
    <aside
      className="qitu-tutor-col qitu-tutor-col-right qitu-tutor-team-rail"
      aria-label="AI 导师 Team"
    >
      <section className="qitu-tutor-team-panel">
        <header className="qitu-tutor-team-header">
          <div>
            <p className="qitu-tutor-team-eyebrow">TEAM</p>
            <h2>AI 导师协作</h2>
          </div>
          <span className="qitu-tutor-team-lock" title="协作详情由服务端保护">
            只读
          </span>
        </header>
        <p className="qitu-tutor-team-description">
          AI 导师负责和你对话，专项 Agent 会在需要时协助兴趣确认、项目推荐和 PBL 推进。
        </p>
        <ol className="qitu-tutor-team-list">
          <TutorTeamItem
            label="AI 导师"
            detail="Team Leader · 当前对话入口"
            status={leaderStatus}
          />
          <TutorTeamItem
            label="兴趣确认"
            detail="按需调用，状态由服务端记录后确认"
            status="waiting"
          />
          <TutorTeamItem
            label="项目推荐"
            detail="按需调用，状态由服务端记录后确认"
            status="waiting"
          />
          <TutorTeamItem
            label="PBL 推进"
            detail="按需调用，状态由服务端记录后确认"
            status="waiting"
          />
          <TutorTeamItem
            label="成长记录"
            detail="按需调用，状态由服务端记录后确认"
            status="waiting"
          />
        </ol>
        <p className="qitu-tutor-team-footnote">子 Agent 的原始消息不会显示在学生端。</p>
      </section>
    </aside>
  );
}

function TutorTeamItem({
  label,
  detail,
  status,
}: {
  label: string;
  detail: string;
  status: TeamNodeStatus;
}) {
  return (
    <li className="qitu-tutor-team-item">
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <TeamStatusBadge status={status} />
    </li>
  );
}
