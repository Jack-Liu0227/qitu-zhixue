'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { AssistantGlyph, ResizablePanels } from '@qitu/ui';
import type { AdminTeamMember, AdminAssistantConfig, TeammateRole } from '@qitu/contracts';
import { configuredModelLabel, configuredModelKey, type ConfiguredModelItem } from '../../../../../lib/api/configuredModels';

interface MemberEditorProps {
  member: AdminTeamMember;
  assistant?: AdminAssistantConfig;
  configuredModels: ConfiguredModelItem[];
  onSave: (updates: Partial<AdminTeamMember>) => Promise<void>;
  onClose: () => void;
}
const roles: Record<TeammateRole, string> = { leader: '队长 / 总负责人', coach: '原理教练', teammate: '伙伴向导', reviewer: '评审导师' };
const capabilityTabs = [{ id: 'instruction', label: '指令' }, { id: 'skills', label: 'Skills' }, { id: 'mcp', label: '工具与 MCP' }, { id: 'integration', label: '集成' }] as const;
const settingTabs = [{ id: 'general', label: '通用' }, { id: 'permissions', label: '权限' }, { id: 'env', label: '环境变量' }, { id: 'custom', label: '自定义' }] as const;

export function MemberEditor({ member, assistant, configuredModels, onSave, onClose }: MemberEditorProps) {
  const [tab, setTab] = useState<'overview' | 'work' | 'capabilities' | 'settings'>('capabilities');
  const [capability, setCapability] = useState<string>('instruction');
  const [setting, setSetting] = useState<string>('general');
  const [role, setRole] = useState(member.role);
  const [roleLabel, setRoleLabel] = useState(member.roleLabel || roles[member.role]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const assistantHref = `/settings/assistants?assistantId=${encodeURIComponent(member.assistantId)}`;
  const model = configuredModels.find(item => item.providerId === assistant?.modelProviderId && item.id === assistant.modelId);
  async function save() {
    if (inFlight.current || !roleLabel.trim()) return;
    inFlight.current = true; setSaving(true); setError('');
    try { await onSave({ role, roleLabel: roleLabel.trim() }); }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : '成员配置未确认保存，请重试。'); }
    finally { inFlight.current = false; setSaving(false); }
  }
  const capabilityContent = capability === 'instruction' ? <>
    <h3>系统指令</h3><p className="member-editor-note">团队使用该助手统一维护的指令。修改后，课程需重新保存教学安排。</p>
    <Link className="qitu-button qitu-button-primary" href={assistantHref}>前往助手编辑指令</Link>
    <pre className="member-instruction-readonly">{assistant?.instructions || '该助手暂无已保存的指令。'}</pre>
  </> : capability === 'skills' ? <CapabilityList title="已绑定技能" items={assistant?.enabledSkills ?? []} href={assistantHref} action="管理助手技能" empty="该助手尚未绑定技能。" />
    : capability === 'mcp' ? <><CapabilityList title="已授权工具" items={assistant?.toolIds ?? []} href="/settings/tools" action="管理工具授权" empty="该助手尚未获得工具授权。" />
      <CapabilityList title="MCP 服务" items={assistant?.mcpServerIds ?? []} href="/settings/tools" action="查看服务连接" empty="尚未绑定 MCP 服务。" />
      <p className="member-editor-note">授权和服务连接均有效时，助手才可调用。已有项目继续使用确认时的教学安排。</p></>
      : <><h3>第三方集成</h3><p className="member-editor-note">在知识中心维护资料来源，在工具中心检查外部服务连接。</p><div className="member-editor-links">
        <Link className="qitu-button" href="/settings/knowledge">知识中心</Link><Link className="qitu-button" href="/settings/tools">工具与 MCP</Link></div></>;
  const general = <><h3>团队中的职责</h3><div className="member-editor-form">
    <label>角色类型<select value={role} disabled={saving} onChange={event => { const value = event.target.value; if (value === 'leader' || value === 'coach' || value === 'teammate' || value === 'reviewer') setRole(value); }}>
      {Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>角色标签<input value={roleLabel} disabled={saving} maxLength={120} onChange={event => setRoleLabel(event.target.value)} /></label>
    <div><strong>默认模型</strong><p>{model ? configuredModelLabel(configuredModelKey(model), configuredModels) : assistant?.modelId ?? '尚未配置'}</p><Link href={assistantHref}>在助手设置中管理模型 →</Link></div>
  </div></>;
  const settingsContent = setting === 'general' || setting === 'custom' ? general
    : setting === 'permissions' ? <><h3>助手权限</h3><p className="member-editor-note">权限沿用助手的工具、技能与知识库授权，项目运行时还会核对其教学范围。</p>
      <div className="member-editor-links"><Link className="qitu-button" href="/settings/tools">工具授权</Link><Link className="qitu-button" href="/settings/knowledge">知识库授权</Link></div></>
      : <><h3>连接与运行配置</h3><p className="member-editor-note">提供商凭据在模型接入中维护，外部工具的连接参数在工具中心维护。</p>
        <div className="member-editor-links"><Link className="qitu-button" href="/settings/model-providers">模型接入</Link><Link className="qitu-button" href="/settings/tools">工具连接</Link></div></>;

  return <div className="member-editor-container">
    <header className="member-editor-header">
      <button type="button" className="member-editor-back" disabled={saving} onClick={onClose}>← 返回团队</button>
      <div className="member-editor-tabs" role="tablist" aria-label="团队成员配置">{([
        ['overview', '概览'], ['work', '工作'], ['capabilities', '能力'], ['settings', '设置'],
      ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={`editor-tab ${tab === value ? 'is-active' : ''}`} onClick={() => setTab(value)}>{label}</button>)}</div>
      <div className="member-editor-actions"><button type="button" className="save-member-btn" onClick={() => void save()} disabled={saving || !roleLabel.trim()}>{saving ? '正在保存…' : '保存团队职责'}</button>
        <button type="button" className="cancel-member-btn" onClick={onClose} disabled={saving}>取消</button></div>
    </header>
    {error && <p role="alert" className="member-editor-error">{error}</p>}
    <div className="member-editor-identity"><AssistantGlyph value={assistant?.avatar || member.avatar} size={40} /><div><strong>{assistant?.name || member.assistantName}</strong><p>{roleLabel} · {assistant?.enabled ? '助手已启用' : '助手未启用'}</p></div></div>
    {tab === 'capabilities' || tab === 'settings' ? <ResizablePanels storageKey={`admin-member-${tab}`} className="member-editor-body" initialSizes={[22, 78]} minWidths={[160, 340]} stackBelow={620} labels={['配置分类', '配置详情']}>
      <nav className="member-editor-sidebar" aria-label="成员配置分类">{(tab === 'capabilities' ? capabilityTabs : settingTabs).map(item => <button key={item.id} type="button"
        aria-pressed={(tab === 'capabilities' ? capability : setting) === item.id} className={`sidebar-btn ${(tab === 'capabilities' ? capability : setting) === item.id ? 'is-active' : ''}`}
        onClick={() => tab === 'capabilities' ? setCapability(item.id) : setSetting(item.id)}>{item.label}</button>)}</nav>
      <section className="member-editor-content">{tab === 'capabilities' ? capabilityContent : settingsContent}</section>
    </ResizablePanels> : <section className="member-editor-content">{tab === 'overview' ? <>
      <h3>成员概览</h3><dl className="member-overview"><div><dt>团队角色</dt><dd>{roles[member.role]}</dd></div><div><dt>教学模型</dt><dd>{model ? configuredModelLabel(configuredModelKey(model), configuredModels) : assistant?.modelId ?? '尚未配置'}</dd></div>
        <div><dt>技能</dt><dd>{assistant?.enabledSkills.length ?? 0} 项</dd></div><div><dt>工具</dt><dd>{assistant?.toolIds.length ?? 0} 项</dd></div></dl><Link className="qitu-button" href={assistantHref}>查看完整助手配置</Link>
    </> : <><h3>教学工作安排</h3><p className="member-editor-note">在项目模板中选择这支团队，并为每个课时安排教学者。修改后的安排经检查并启用后，用于新确认的项目。</p>
      <Link className="qitu-button qitu-button-primary" href="/settings/templates">查看项目模板与课时安排</Link></>}</section>}
  </div>;
}

function CapabilityList({ title, items, href, action, empty }: { title: string; items: readonly string[]; href: string; action: string; empty: string }) {
  return <section className="member-capability-section"><header><h3>{title}</h3><Link className="qitu-button" href={href}>{action}</Link></header>
    {items.length ? <ul>{items.map(item => <li key={item}>{item}</li>)}</ul> : <p className="member-editor-note">{empty}</p>}</section>;
}
