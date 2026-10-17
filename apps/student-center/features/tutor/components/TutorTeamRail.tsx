'use client';

import { useState } from 'react';
import type { TutorPhaseProjection } from '@qitu/contracts';

interface TutorTeamRailProps {
  phases: TutorPhaseProjection[];
}

/** Server projection only: no phase names, order, gates, or deliverables are invented here. */
export function TutorTeamRail({ phases }: TutorTeamRailProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const orderedPhases = [...phases].sort((a, b) => a.orderIndex - b.orderIndex);

  if (orderedPhases.length === 0) {
    return (
      <section className="qitu-tutor-phase-tree qitu-tutor-state-panel" aria-label="项目阶段">
        <strong>暂无项目阶段</strong>
        <p>服务端还没有返回当前项目的阶段投影。</p>
      </section>
    );
  }

  return (
    <section className="qitu-tutor-phase-tree" aria-label="项目阶段">
      <div className="qitu-tutor-phase-tree-heading">
        <div>
          <span>PROJECT PHASES</span>
          <h3>阶段进度</h3>
        </div>
        <span>{orderedPhases.length} 个阶段</span>
      </div>
      <ol>
        {orderedPhases.map((phase) => {
          const isExpanded = expanded.has(phase.phaseId);
          const statusLabel = phase.status === 'completed' ? '已完成' : phase.status === 'active' ? '进行中' : '未解锁';
          const gateLabel = phase.requiresGateApproval
            ? phase.gateStatus === 'passed' ? '门禁已通过' : phase.gateStatus === 'failed' ? '门禁未通过' : '等待门禁核验'
            : '无需门禁';
          return (
            <li key={phase.phaseId} className={`qitu-tutor-phase is-${phase.status}`}>
              <button
                type="button"
                className="qitu-tutor-phase-toggle"
                aria-expanded={isExpanded}
                onClick={() => setExpanded((previous) => {
                  const next = new Set(previous);
                  if (next.has(phase.phaseId)) next.delete(phase.phaseId);
                  else next.add(phase.phaseId);
                  return next;
                })}
              >
                <span className="qitu-tutor-phase-order">{phase.status === 'completed' ? '✓' : phase.orderIndex}</span>
                <span className="qitu-tutor-phase-copy">
                  <strong>{phase.name}</strong>
                  <span>{statusLabel} · {gateLabel}</span>
                </span>
                <span aria-hidden="true">{isExpanded ? '⌃' : '⌄'}</span>
              </button>
              {isExpanded ? (
                <div className="qitu-tutor-phase-details">
                  <p>负责助手：{phase.assignedAssistantName ?? '未指派'}</p>
                  {phase.gateRule ? <p>门禁规则：{phase.gateRule}</p> : null}
                  <div className="qitu-tutor-deliverables">
                    <strong>交付物</strong>
                    {phase.requiredDeliverables.length === 0 ? (
                      <span>暂无交付物</span>
                    ) : phase.requiredDeliverables.map((deliverable) => (
                      <span key={deliverable.id} className={deliverable.submitted ? 'is-submitted' : ''}>
                        {deliverable.submitted ? '✓' : '○'} {deliverable.title}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
