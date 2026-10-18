'use client';

import { useState } from 'react';
import type { AdminTeamMember, AdminAssistantConfig } from '@qitu/contracts';
import type { ConfiguredModelItem } from '../../../../../lib/api/configuredModels';

interface MemberEditorProps {
  member: AdminTeamMember;
  assistant?: AdminAssistantConfig;
  configuredModels: ConfiguredModelItem[];
  onSave: (updates: Partial<AdminTeamMember>) => Promise<void>;
  onClose: () => void;
}

export function MemberEditor({
  member,
  assistant,
  configuredModels,
  onSave,
  onClose,
}: MemberEditorProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'work' | 'capabilities' | 'settings'>('capabilities');
  const [capabilitiesSubTab, setCapabilitiesSubTab] = useState<'instruction' | 'skills' | 'mcp' | 'integration'>('instruction');
  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'permissions' | 'env' | 'custom'>('general');
  
  const [formData, setFormData] = useState({
    role: member.role,
    roleLabel: member.roleLabel || getRoleLabel(member.role),
    systemPrompt: assistant?.instructions || '',
  });

  const handleSave = async () => {
    await onSave({
      role: formData.role,
      roleLabel: formData.roleLabel,
    });
    onClose();
  };

  return (
    <div className="member-editor-container">
      {/* 顶部导航栏 */}
      <div className="member-editor-header">
        <button
          type="button"
          className="member-editor-back"
          onClick={onClose}
        >
          ← 返回团队
        </button>
        
        <div className="member-editor-tabs">
          <button
            type="button"
            className={`editor-tab ${activeTab === 'overview' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            概览
          </button>
          <button
            type="button"
            className={`editor-tab ${activeTab === 'work' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('work')}
          >
            工作
          </button>
          <button
            type="button"
            className={`editor-tab ${activeTab === 'capabilities' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('capabilities')}
          >
            能力
          </button>
          <button
            type="button"
            className={`editor-tab ${activeTab === 'settings' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            设置
          </button>
        </div>

        <div className="member-editor-actions">
          <button
            type="button"
            className="save-member-btn"
            onClick={handleSave}
          >
            保存配置
          </button>
          <button
            type="button"
            className="cancel-member-btn"
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>

      {/* 主编辑区域 */}
      <div className="member-editor-body">
        {activeTab === 'capabilities' && (
          <>
            <aside className="member-editor-sidebar">
              <button
                type="button"
                className={`sidebar-btn ${capabilitiesSubTab === 'instruction' ? 'is-active' : ''}`}
                onClick={() => setCapabilitiesSubTab('instruction')}
              >
                指令
              </button>
              <button
                type="button"
                className={`sidebar-btn ${capabilitiesSubTab === 'skills' ? 'is-active' : ''}`}
                onClick={() => setCapabilitiesSubTab('skills')}
              >
                Skills
              </button>
              <button
                type="button"
                className={`sidebar-btn ${capabilitiesSubTab === 'mcp' ? 'is-active' : ''}`}
                onClick={() => setCapabilitiesSubTab('mcp')}
              >
                MCP
              </button>
              <button
                type="button"
                className={`sidebar-btn ${capabilitiesSubTab === 'integration' ? 'is-active' : ''}`}
                onClick={() => setCapabilitiesSubTab('integration')}
              >
                集成
              </button>
            </aside>

            <main className="member-editor-content">
              {capabilitiesSubTab === 'instruction' && (
                <InstructionPanel
                  systemPrompt={formData.systemPrompt}
                  onChange={(value) => setFormData({ ...formData, systemPrompt: value })}
                />
              )}
              {capabilitiesSubTab === 'skills' && <SkillsPanel />}
              {capabilitiesSubTab === 'mcp' && <McpPanel />}
              {capabilitiesSubTab === 'integration' && <IntegrationPanel />}
            </main>
          </>
        )}

        {activeTab === 'settings' && (
          <>
            <aside className="member-editor-sidebar">
              <button
                type="button"
                className={`sidebar-btn ${settingsSubTab === 'general' ? 'is-active' : ''}`}
                onClick={() => setSettingsSubTab('general')}
              >
                通用
              </button>
              <button
                type="button"
                className={`sidebar-btn ${settingsSubTab === 'permissions' ? 'is-active' : ''}`}
                onClick={() => setSettingsSubTab('permissions')}
              >
                权限
              </button>
              <button
                type="button"
                className={`sidebar-btn ${settingsSubTab === 'env' ? 'is-active' : ''}`}
                onClick={() => setSettingsSubTab('env')}
              >
                环境变量
              </button>
              <button
                type="button"
                className={`sidebar-btn ${settingsSubTab === 'custom' ? 'is-active' : ''}`}
                onClick={() => setSettingsSubTab('custom')}
              >
                自定义
              </button>
            </aside>

            <main className="member-editor-content">
              {settingsSubTab === 'general' && (
                <GeneralSettingsPanel
                  formData={formData}
                  configuredModels={configuredModels}
                  onChange={setFormData}
                />
              )}
              {settingsSubTab === 'permissions' && <PermissionsPanel />}
              {settingsSubTab === 'env' && <EnvPanel />}
              {settingsSubTab === 'custom' && <CustomPanel />}
            </main>
          </>
        )}

        {activeTab === 'overview' && <OverviewPanel member={member} assistant={assistant} />}
        {activeTab === 'work' && <WorkPanel />}
      </div>
    </div>
  );
}

function InstructionPanel({
  systemPrompt,
  onChange,
}: {
  systemPrompt: string;
  onChange: (value: string) => void;
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  return (
    <div className="instruction-panel">
      <div className="instruction-panel-header">
        <h3>系统指令</h3>
        <div className="instruction-tabs">
          <button
            type="button"
            className={`instruction-tab ${tab === 'edit' ? 'is-active' : ''}`}
            onClick={() => setTab('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            className={`instruction-tab ${tab === 'preview' ? 'is-active' : ''}`}
            onClick={() => setTab('preview')}
          >
            预览
          </button>
        </div>
      </div>

      {tab === 'edit' ? (
        <textarea
          className="instruction-editor"
          value={systemPrompt}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入系统指令..."
        />
      ) : (
        <div className="instruction-preview markdown-body">
          {systemPrompt || '暂无指令'}
        </div>
      )}
    </div>
  );
}

function SkillsPanel() {
  return (
    <div className="skills-panel">
      <h3>Skills 配置</h3>
      <p>技能配置功能开发中...</p>
    </div>
  );
}

function McpPanel() {
  return (
    <div className="mcp-panel">
      <h3>MCP 工具</h3>
      <p>MCP 配置功能开发中...</p>
    </div>
  );
}

function IntegrationPanel() {
  return (
    <div className="integration-panel">
      <h3>第三方集成</h3>
      <p>集成配置功能开发中...</p>
    </div>
  );
}

function GeneralSettingsPanel({
  formData,
  configuredModels,
  onChange,
}: {
  formData: any;
  configuredModels: ConfiguredModelItem[];
  onChange: (data: any) => void;
}) {
  return (
    <div className="general-settings-panel">
      <h3>通用设置</h3>
      
      <div className="form-group">
        <label>角色类型</label>
        <select
          value={formData.role}
          onChange={(e) => onChange({ ...formData, role: e.target.value })}
        >
          <option value="leader">队长/总负责人</option>
          <option value="coach">原理教练</option>
          <option value="teammate">伙伴向导</option>
          <option value="reviewer">评审导师</option>
        </select>
      </div>

      <div className="form-group">
        <label>角色标签</label>
        <input
          type="text"
          value={formData.roleLabel}
          onChange={(e) => onChange({ ...formData, roleLabel: e.target.value })}
          placeholder="自定义角色标签"
        />
      </div>

      <div className="form-group">
        <label>默认模型</label>
        <p>跟随已绑定助手的供应商与模型。请在助手设置中统一管理；团队成员不另存裸模型覆盖。</p>
      </div>
    </div>
  );
}

function PermissionsPanel() {
  return (
    <div className="permissions-panel">
      <h3>权限设置</h3>
      <p>权限配置功能开发中...</p>
    </div>
  );
}

function EnvPanel() {
  return (
    <div className="env-panel">
      <h3>环境变量</h3>
      <p>环境变量配置功能开发中...</p>
    </div>
  );
}

function CustomPanel() {
  return (
    <div className="custom-panel">
      <h3>自定义配置</h3>
      <p>自定义配置功能开发中...</p>
    </div>
  );
}

function OverviewPanel({
  member,
  assistant,
}: {
  member: AdminTeamMember;
  assistant?: AdminAssistantConfig;
}) {
  return (
    <div className="overview-panel">
      <h3>成员概览</h3>
      <div className="overview-info">
        <div className="info-item">
          <span className="info-label">名称</span>
          <span className="info-value">{member.assistantName || assistant?.name || '未知导师'}</span>
        </div>
        <div className="info-item">
          <span className="info-label">角色</span>
          <span className="info-value">{member.roleLabel || getRoleLabel(member.role)}</span>
        </div>
        <div className="info-item">
          <span className="info-label">模型</span>
          <span className="info-value">{member.model || '自动'}</span>
        </div>
      </div>
    </div>
  );
}

function WorkPanel() {
  return (
    <div className="work-panel">
      <h3>工作配置</h3>
      <p>工作配置功能开发中...</p>
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
