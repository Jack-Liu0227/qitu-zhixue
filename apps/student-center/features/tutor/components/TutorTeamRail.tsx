import { TeamStatusBadge, type TeamNodeStatus } from '@qitu/ui';

interface TutorTeamRailProps {
  currentTeam?: 'team-thunder-fighter' | 'team-kinetic-energy';
  streaming: boolean;
  ready: boolean;
  failed: boolean;
  offline: boolean;
}

/**
 * A student-safe Team projection. It intentionally exposes role-level status
 * only; mailbox payloads, prompts and other students' evidence stay server-side.
 */
export function TutorTeamRail({
  currentTeam = 'team-kinetic-energy',
  streaming,
  ready,
  failed,
  offline,
}: TutorTeamRailProps) {
  const leaderStatus: TeamNodeStatus = offline
    ? 'offline'
    : failed
    ? 'failed'
    : streaming
    ? 'running'
    : ready
    ? 'ready'
    : 'waiting';

  const isKinetic = currentTeam === 'team-kinetic-energy';

  return (
    <aside className="qitu-tutor-col qitu-tutor-col-right qitu-tutor-team-rail" aria-label="AI 导师 Team" style={{ width: '280px', flexShrink: 0 }}>
      <section className="qitu-tutor-team-panel">
        <header className="qitu-tutor-team-header">
          <div>
            <p className="qitu-tutor-team-eyebrow">PBL MULTI-AGENT</p>
            <h2>{isKinetic ? '动能定理导师团队' : '雷霆战机导师团队'}</h2>
          </div>
          <span className="qitu-tutor-team-lock" title="智能体角色配置由后台统一管控">在线</span>
        </header>
        <p className="qitu-tutor-team-description">
          {isKinetic
            ? '多导师协作探究力与位移做功，通过苏格拉底式提问引导推导动能定理。'
            : '多导师引导构建飞行射击游戏，严守 TheoryMastered 门禁后再进入代码实践。'}
        </p>
        <ol className="qitu-tutor-team-list">
          <TutorTeamItem
            label={isKinetic ? '苏格拉底教练' : '战机原理教练'}
            detail="Coach · 主导概念提问与门禁"
            status={leaderStatus}
          />
          <TutorTeamItem
            label={isKinetic ? '探索向导 (小凯)' : '互动向导 (小翼)'}
            detail="Teammate · 实验观察与思路启发"
            status="waiting"
          />
          <TutorTeamItem
            label={isKinetic ? '严谨评审导师' : '代码评审导师'}
            detail="Reviewer · 公式推导与阶段门禁核准"
            status="waiting"
          />
          <TutorTeamItem
            label="成长分析引擎"
            detail="系统 Agent · 自动捕获四维能力轨迹"
            status="ready"
          />
        </ol>
        <div style={{ marginTop: '10px', padding: '8px 10px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', fontSize: '11.5px', color: '#166534' }}>
          <strong>🔒 阶段门禁：TheoryMastered</strong>
          <div style={{ marginTop: '2px', color: '#15803d' }}>必须完全理解物理概念与数学推导后，系统方解锁后续代码实践。</div>
        </div>
      </section>
    </aside>
  );
}

function TutorTeamItem({ label, detail, status }: { label: string; detail: string; status: TeamNodeStatus }) {
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
