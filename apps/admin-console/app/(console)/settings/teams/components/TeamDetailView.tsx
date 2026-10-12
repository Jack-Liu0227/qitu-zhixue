'use client';

import type { AdminTeamConfig, AdminTeamMember, AdminAssistantConfig } from '@qitu/contracts';
import { useState } from 'react';

interface TeamDetailViewProps {
  team: AdminTeamConfig;
  allAssistants: AdminAssistantConfig[];
  onBack: () => void;
  onUpdateTeam: (updates: Partial<AdminTeamConfig>) => Promise<void>;
  onOpenMemberEdit: (member: AdminTeamMember) => void;
  onRemoveMember: (slotId: string, memberName: string) => Promise<void>;
  onSetLeader: (assistantId: string) => Promise<void>;
}

export function TeamDetailView({
  team,
  allAssistants,
  onBack,
  onUpdateTeam,
  onOpenMemberEdit,
  onRemoveMember,
  onSetLeader,
}: TeamDetailViewProps) {
  const [activeTab, setActiveTab] = useState<'members' | 'guide'>('members');
  const [guideText, setGuideText] = useState(team.description || '');
  const [isEditingGuide, setIsEditingGuide] = useState(false);

  const handleSaveGuide = async () => {
    await onUpdateTeam({ description: guideText });
    setIsEditingGuide(false);
  };

  return (
    <div className="team-detail-view">
      <div className="team-detail-header">
        <button
          type="button"
          className="team-back-btn"
          onClick={onBack}
        >
          ← 返回团队列表
        </button>
        <div className="team-detail-title">
          <h2>{team.name}</h2>
          <p>{team.members.length} 名成员</p>
        </div>
      </div>

      <div className="team-detail-tabs">
        <button
          type="button"
          className={`team-tab ${activeTab === 'members' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('members')}
        >
          团队成员
        </button>
        <button
          type="button"
          className={`team-tab ${activeTab === 'guide' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('guide')}
        >
          运行指引
        </button>
      </div>

      <div className="team-detail-content">
        {activeTab === 'members' ? (
          <MembersPanel
            team={team}
            allAssistants={allAssistants}
            onOpenMemberEdit={onOpenMemberEdit}
            onRemoveMember={onRemoveMember}
            onSetLeader={onSetLeader}
          />
        ) : (
          <GuidePanel
            guideText={guideText}
            isEditing={isEditingGuide}
            onGuideChange={setGuideText}
            onStartEdit={() => setIsEditingGuide(true)}
            onSave={handleSaveGuide}
            onCancel={() => {
              setGuideText(team.description || '');
              setIsEditingGuide(false);
            }}
          />
        )}
      </div>

      {/* 角色说明面板 */}
      <RoleExplanationPanel />
    </div>
  );
}

function MembersPanel({
  team,
  allAssistants,
  onOpenMemberEdit,
  onRemoveMember,
  onSetLeader,
}: {
  team: AdminTeamConfig;
  allAssistants: AdminAssistantConfig[];
  onOpenMemberEdit: (member: AdminTeamMember) => void;
  onRemoveMember: (slotId: string, memberName: string) => Promise<void>;
  onSetLeader: (assistantId: string) => Promise<void>;
}) {
  return (
    <div className="members-panel">
      <div className="members-panel-header">
        <h3>团队成员 ({team.members.length})</h3>
        <button type="button" className="add-member-btn">
          + 添加成员
        </button>
      </div>

      <div className="members-list">
        {team.members.map((member) => {
          const assistant = allAssistants.find((a) => a.id === member.assistantId);
          const isLeader = member.assistantId === team.leaderAssistantId;
          const displayName = member.assistantName || assistant?.name || '未知导师';
          const displayRole = member.roleLabel || getRoleLabel(member.role);

          return (
            <div
              key={member.slotId}
              className="member-card"
              onClick={() => onOpenMemberEdit(member)}
            >
              <div className="member-card-avatar">
                {member.avatar || assistant?.avatar || '🤖'}
              </div>
              <div className="member-card-info">
                <div className="member-card-name">
                  {displayName}
                  {isLeader && <span className="leader-badge">👑 队长</span>}
                </div>
                <div className="member-card-role">{displayRole}</div>
                <div className="member-card-status">在线 · 最近活动 刚刚</div>
              </div>
              <div className="member-card-actions" onClick={(e) => e.stopPropagation()}>
                {!isLeader && (
                  <button
                    type="button"
                    className="member-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetLeader(member.assistantId);
                    }}
                    title="设为队长"
                  >
                    👑
                  </button>
                )}
                <button
                  type="button"
                  className="member-action-btn is-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveMember(member.slotId, displayName);
                  }}
                  title="移除成员"
                >
                  🗑️
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GuidePanel({
  guideText,
  isEditing,
  onGuideChange,
  onStartEdit,
  onSave,
  onCancel,
}: {
  guideText: string;
  isEditing: boolean;
  onGuideChange: (text: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [previewTab, setPreviewTab] = useState<'edit' | 'preview'>('edit');

  return (
    <div className="guide-panel">
      <div className="guide-panel-header">
        <h3>运行与交付指引</h3>
        {!isEditing ? (
          <button type="button" className="edit-guide-btn" onClick={onStartEdit}>
            编辑指引
          </button>
        ) : (
          <div className="guide-panel-actions">
            <div className="guide-tabs">
              <button
                type="button"
                className={`guide-tab ${previewTab === 'edit' ? 'is-active' : ''}`}
                onClick={() => setPreviewTab('edit')}
              >
                编辑
              </button>
              <button
                type="button"
                className={`guide-tab ${previewTab === 'preview' ? 'is-active' : ''}`}
                onClick={() => setPreviewTab('preview')}
              >
                预览
              </button>
            </div>
            <button type="button" className="save-guide-btn" onClick={onSave}>
              保存
            </button>
            <button type="button" className="cancel-guide-btn" onClick={onCancel}>
              取消
            </button>
          </div>
        )}
      </div>

      <div className="guide-panel-content">
        {isEditing && previewTab === 'edit' ? (
          <textarea
            className="guide-editor"
            value={guideText}
            onChange={(e) => onGuideChange(e.target.value)}
            placeholder="输入团队运行指引..."
          />
        ) : (
          <div className="guide-preview markdown-body">
            {guideText || '暂无运行指引'}
          </div>
        )}
      </div>
    </div>
  );
}

function RoleExplanationPanel() {
  return (
    <div className="role-explanation-panel">
      <div className="role-explanation-header">
        <span className="role-icon">💡</span>
        <strong>PBL 导师团队四类角色分工与调度机制</strong>
      </div>
      <p className="role-explanation-intro">
        为确保项目式学习教学质量与防作弊红线，每个团队固化了 4 类角色职责。
        在学生不同探究阶段，由 Team Orchestrator 状态机按阶段流转激活：
      </p>
      <div className="role-cards-grid">
        <div className="role-card">
          <div className="role-card-title">
            <span className="role-emoji">👑</span>
            <strong>队长 / 总负责人 (Leader)</strong>
          </div>
          <p className="role-card-desc">
            把控探究大方向。在学生提出想法时进行目标拆解，只有明确意图后才批准立项，防止盲目开题。
          </p>
        </div>

        <div className="role-card">
          <div className="role-card-title">
            <span className="role-emoji">🎓</span>
            <strong>原理教练 (Coach)</strong>
          </div>
          <p className="role-card-desc">
            苏格拉底式启发教学主力。主导 TheoryMastered 概念门禁，在学生未掌握原理前严格锁死完整代码生成。
          </p>
        </div>

        <div className="role-card">
          <div className="role-card-title">
            <span className="role-emoji">💻</span>
            <strong>伙伴向导 (Teammate)</strong>
          </div>
          <p className="role-card-desc">
            动手实践伙伴。在沙箱中指导学生分步编写代码、构建实验装置，引导学生看懂 Traceback 错误栈。
          </p>
        </div>

        <div className="role-card">
          <div className="role-card-title">
            <span className="role-emoji">⚖️</span>
            <strong>评审导师 (Reviewer)</strong>
          </div>
          <p className="role-card-desc">
            结项答辩专家。依据 PBL 量规（Rubric）对学生进行防作弊概念质询与掌握度打分，归档终身成长档案。
          </p>
        </div>
      </div>
    </div>
  );
}

function getRoleLabel(role: string): string {
  const roleMap: Record<string, string> = {
    leader: '队长/总负责人',
    coach: '原理教练',
    teammate: '伙伴向导',
    reviewer: '评审导师',
  };
  return roleMap[role] || '导师';
}
