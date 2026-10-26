'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AssistantGlyph } from '@qitu/ui';
import type { AdminTeamMember, AdminAssistantConfig, TeammateRole, AdminRuntimeSnapshot } from '@qitu/contracts';
import {
  configuredModelLabel,
  configuredModelKey,
  configuredModelPatch,
  type ConfiguredModelItem,
} from '../../../../../lib/api/configuredModels';
import { updatePersistedAssistant } from '../../../../../lib/api/assistants';
import { fetchRuntimeSnapshot } from '../../../../../lib/api/runtime';

interface MemberEditorProps {
  member: AdminTeamMember;
  assistant?: AdminAssistantConfig;
  configuredModels: ConfiguredModelItem[];
  onSave: (updates: Partial<AdminTeamMember>) => Promise<void>;
  onClose: () => void;
}

const ROLE_CONFIGS: Record<TeammateRole, { label: string; defaultName: string; badge: string; desc: string }> = {
  leader: {
    label: '队长 / 总负责人',
    defaultName: '总负责人 / 队长',
    badge: '👑',
    desc: '负责引导整个探究流的破题开篇、协调各阶段分工、跟进总任务目标与把控进度节奏。',
  },
  coach: {
    label: '原理教练',
    defaultName: '原理与概念教练',
    badge: '🧠',
    desc: '负责学科原理启发、前概念探查、引导苏格拉底式思考，并通过理论门禁考核（TheoryMastered）。',
  },
  teammate: {
    label: '伙伴向导',
    defaultName: '探究与实验向导',
    badge: '🧭',
    desc: '负责引导动手实践、虚拟仿真对比实验设计、数据素养与操作纠错。',
  },
  reviewer: {
    label: '评审导师',
    defaultName: '成果与答辩评审导师',
    badge: '⚖️',
    desc: '负责学生作品迭代批注、CER 科学论证审核、结项成果答辩与深度质询。',
  },
};

const ROLES: Record<TeammateRole, string> = {
  leader: ROLE_CONFIGS.leader.label,
  coach: ROLE_CONFIGS.coach.label,
  teammate: ROLE_CONFIGS.teammate.label,
  reviewer: ROLE_CONFIGS.reviewer.label,
};

const FALLBACK_SKILLS = [
  { id: 'tutor-guided-learning', name: '苏格拉底导学 (tutor-guided-learning)', desc: '基于苏格拉底提问启发式引导' },
  { id: 'optics-wave-inquiry', name: '波动光学探究 (optics-wave-inquiry)', desc: '单缝衍射与微粒散射实验启发' },
  { id: 'pbl-cer-coach', name: 'CER 科学论证教练 (pbl-cer-coach)', desc: '主张-证据-推理逻辑构建' },
  { id: 'pbl-experiment-design', name: '对比实验设计 (pbl-experiment-design)', desc: '控制变量法与实验方案规划' },
  { id: 'pbl-defense-coach', name: '结项答辩教练 (pbl-defense-coach)', desc: '答辩质询与深度追问' },
  { id: 'pbl-concept-probe', name: '前概念探查 (pbl-concept-probe)', desc: '检测学生迷思概念与认知断点' },
  { id: 'pbl-artifact-revision', name: '作品迭代批注 (pbl-artifact-revision)', desc: '基于量规引导作品修改' },
  { id: 'pbl-data-literacy', name: '数据素养指导 (pbl-data-literacy)', desc: '数据单位、误差与极限分析' },
];

const FALLBACK_MCP_SERVERS = [
  { id: 'optics-physical-inquiry-mcp', label: '启途物理探究仿真MCP服务', desc: '单缝衍射与细雾室散射物理仿真内核' },
  { id: 'fetch', label: 'fetch 网页抓取', desc: '读取外部文档与资料正文' },
  { id: 'groksearch', label: 'groksearch 实时检索', desc: '互联网最新学术与科普文献检索' },
  { id: 'aionui-browser', label: 'aionui-browser 浏览器沙箱', desc: '网页可视化操作与 DOM 解析' },
  { id: 'chrome-devtools', label: 'chrome-devtools 调试套件', desc: '控制台日志与网络通信跟踪' },
];

const FALLBACK_TOOLS = [
  { id: 'knowledge_search', label: '知识库检索 (knowledge_search)', desc: '检索管理员授权的教材与资料' },
  { id: 'knowledge_read', label: '知识库来源读取 (knowledge_read)', desc: '读取检索命中段落的完整证据正文' },
  { id: 'mastery_query', label: '知识掌握度查询 (mastery_query)', desc: '只读获取学生当前核心概念掌握状态' },
  { id: 'student_profile_get', label: '学生学情画像查询 (student_profile_get)', desc: '读取当前学生认知倾向与能力雷达' },
  { id: 'tutor.context_packet', label: '导师上下文封包 (tutor.context_packet)', desc: '组合有界脱敏的课时对话上下文' },
  { id: 'tutor.pedagogy_move', label: '苏格拉底教学动作 (tutor.pedagogy_move)', desc: '启发引导、提示阶梯与检查题' },
  { id: 'tutor.mastery_gate', label: '理论门禁测评 (tutor.mastery_gate)', desc: '实践前必须通过的 TheoryMastered 判定' },
  { id: 'tutor.propose_lesson_activity', label: '生成课时教学活动 (tutor.propose_lesson_activity)', desc: '动态生成看板、实验仿真与过程性检验题' },
];

export function MemberEditor({
  member,
  assistant,
  configuredModels,
  onSave,
  onClose,
}: MemberEditorProps) {
  // 合并后的 2 个高阶 Tab：角色职责 (role) vs 核心能力与模型配置 (capabilities)
  const [tab, setTab] = useState<'role' | 'capabilities'>('capabilities');

  // 角色与指令状态
  const [role, setRole] = useState<TeammateRole>(member.role);
  const [roleLabel, setRoleLabel] = useState(member.roleLabel || ROLES[member.role] || '');
  const [instructions, setInstructions] = useState(assistant?.instructions || '');

  // 模型配置状态
  const initialModelKey =
    assistant?.modelProviderId && assistant?.modelId
      ? configuredModelKey({ providerId: assistant.modelProviderId, id: assistant.modelId })
      : member.model || '';
  const [selectedModelKey, setSelectedModelKey] = useState<string>(initialModelKey);

  // 技能、MCP、工具多选状态
  const [enabledSkills, setEnabledSkills] = useState<string[]>([...(assistant?.enabledSkills || [])]);
  const [mcpServerIds, setMcpServerIds] = useState<string[]>([...(assistant?.mcpServerIds || [])]);
  const [toolIds, setToolIds] = useState<string[]>([...(assistant?.toolIds || [])]);

  // 运行时快照（动态获取平台已登记的全部 Skills、MCP 与内置工具）
  const [snapshot, setSnapshot] = useState<AdminRuntimeSnapshot | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void fetchRuntimeSnapshot().then(
      (data) => {
        if (active) setSnapshot(data);
      },
      () => {
        // Fallback to presets
      }
    );
    return () => {
      active = false;
    };
  }, []);

  const availableSkills = snapshot?.skills?.length
    ? snapshot.skills.map((s) => ({ id: s.id, name: s.label, desc: s.description }))
    : FALLBACK_SKILLS;

  const availableMcpServers = snapshot?.mcpServers?.length
    ? snapshot.mcpServers.map((m) => ({ id: m.id, label: m.label, desc: `${m.transport} · ${m.toolCount ?? 0} 个挂载工具` }))
    : FALLBACK_MCP_SERVERS;

  const availableTools = snapshot?.builtInTools?.length
    ? snapshot.builtInTools.map((t) => ({ id: t.id, label: t.label, desc: t.description || '平台受控内置工具' }))
    : FALLBACK_TOOLS;

  const handleRoleChange = (newRole: TeammateRole) => {
    setRole(newRole);
    const oldConfig = ROLE_CONFIGS[role];
    const newConfig = ROLE_CONFIGS[newRole];
    const isStandardName =
      !roleLabel.trim() ||
      roleLabel === oldConfig?.defaultName ||
      roleLabel === oldConfig?.label ||
      Object.values(ROLE_CONFIGS).some((c) => c.defaultName === roleLabel || c.label === roleLabel);

    if (isStandardName && newConfig) {
      setRoleLabel(newConfig.defaultName);
    }
  };

  const toggleItem = (list: string[], setList: (next: string[]) => void, id: string) => {
    if (list.includes(id)) {
      setList(list.filter((x) => x !== id));
    } else {
      setList([...list, id]);
    }
  };

  async function save() {
    if (inFlight.current || !roleLabel.trim()) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      // 1. 保存团队成员本身的职责与关联模型
      await onSave({
        role,
        roleLabel: roleLabel.trim(),
        model: selectedModelKey || undefined,
      });

      // 2. 如果存在关联的助手配置，同步持久化助手的模型、指令、技能、MCP与工具配置
      if (assistant) {
        const modelPatch = configuredModelPatch(selectedModelKey, configuredModels);
        await updatePersistedAssistant(assistant.id, {
          role: roleLabel.trim(),
          instructions,
          enabledSkills,
          toolIds,
          mcpServerIds,
          modelProviderId: modelPatch.modelProviderId ?? null,
          modelId: modelPatch.modelId ?? null,
        });
      }

      setNotice('成员职责与各项能力配置已成功保存！');
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '成员配置保存失败，请检查后重试。');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="member-editor-container" style={{ background: '#f8fafc', minHeight: '100%' }}>
      {/* 顶部标题与 Tab 栏 */}
      <header className="member-editor-header">
        <button type="button" className="member-editor-back" disabled={saving} onClick={onClose}>
          ← 返回团队
        </button>

        {/* 合并为 2 个清晰的主 Tab */}
        <div className="member-editor-tabs" role="tablist" aria-label="团队成员配置">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'role'}
            className={`editor-tab ${tab === 'role' ? 'is-active' : ''}`}
            onClick={() => setTab('role')}
          >
            📋 角色职责与基础设定
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'capabilities'}
            className={`editor-tab ${tab === 'capabilities' ? 'is-active' : ''}`}
            onClick={() => setTab('capabilities')}
          >
            ⚡ 核心能力与模型配置 ({enabledSkills.length} 技能 · {mcpServerIds.length} MCP · {toolIds.length} 工具)
          </button>
        </div>

        <div className="member-editor-actions">
          <button
            type="button"
            className="save-member-btn"
            onClick={() => void save()}
            disabled={saving || !roleLabel.trim()}
          >
            {saving ? '正在保存…' : '💾 保存成员配置'}
          </button>
          <button type="button" className="cancel-member-btn" onClick={onClose} disabled={saving}>
            取消
          </button>
        </div>
      </header>

      {/* 提示与错误 */}
      {error && (
        <div style={{ padding: '10px 24px', background: '#fef2f2', color: '#b91c1c', borderBottom: '1px solid #fecaca', fontSize: '13px' }}>
          ⚠️ {error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 24px', background: '#f0fdf4', color: '#15803d', borderBottom: '1px solid #bbf7d0', fontSize: '13px' }}>
          ✓ {notice}
        </div>
      )}

      {/* 身份摘要卡片 */}
      <div
        className="member-editor-identity"
        style={{
          padding: '14px 24px',
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
        }}
      >
        <AssistantGlyph value={assistant?.avatar || member.avatar} size={40} />
        <div>
          <strong style={{ fontSize: '16px', color: '#0f172a' }}>
            {assistant?.name || member.assistantName}
          </strong>
          <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
            {roleLabel} · {member.role === 'leader' ? '👑 团队总负责人' : '团队成员'} ·{' '}
            {assistant?.enabled ? '助手已启用' : '助手未启用'}
          </p>
        </div>
      </div>

      {/* 内容主体：自适应全景排版，消除空旷留白 */}
      <div className="member-editor-content" style={{ padding: '20px 24px', maxWidth: '1440px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* ===================== TAB 1: 角色职责与基础设定 ===================== */}
        {tab === 'role' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) minmax(460px, 1.4fr)', gap: '16px', alignItems: 'stretch' }}>
            {/* 左列：角色定位与课时说明 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', color: '#0f172a', fontWeight: 600 }}>
                    1. 团队内角色定位
                  </h3>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    当前角色：<strong>{ROLE_CONFIGS[role].badge} {ROLE_CONFIGS[role].label}</strong>
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                      角色类型
                    </label>
                    <select
                      value={role}
                      disabled={saving}
                      onChange={(e) => handleRoleChange(e.target.value as TeammateRole)}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', background: '#ffffff' }}
                    >
                      {Object.entries(ROLE_CONFIGS).map(([val, conf]) => (
                        <option key={val} value={val}>
                          {conf.badge} {conf.label}
                        </option>
                      ))}
                    </select>
                    <small style={{ display: 'block', marginTop: '5px', color: '#64748b', fontSize: '11.5px' }}>
                      切换角色类型会自动关联对应的默认显示名称。
                    </small>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                        角色显示标签 (自定义名称)
                      </label>
                      <button
                        type="button"
                        onClick={() => setRoleLabel(ROLE_CONFIGS[role].defaultName)}
                        disabled={saving || roleLabel === ROLE_CONFIGS[role].defaultName}
                        title="重置为当前角色的默认推荐名称"
                        style={{
                          fontSize: '11.5px',
                          padding: '3px 9px',
                          borderRadius: '4px',
                          border: '1px solid #bfdbfe',
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          cursor: roleLabel === ROLE_CONFIGS[role].defaultName ? 'default' : 'pointer',
                          opacity: roleLabel === ROLE_CONFIGS[role].defaultName ? 0.6 : 1,
                          fontWeight: 500,
                        }}
                      >
                        ↺ 填入默认
                      </button>
                    </div>
                    <input
                      value={roleLabel}
                      disabled={saving}
                      maxLength={120}
                      onChange={(e) => setRoleLabel(e.target.value)}
                      placeholder={`例如：${ROLE_CONFIGS[role].defaultName}`}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '13px', background: '#ffffff', boxSizing: 'border-box' }}
                    />
                    <small style={{ display: 'block', marginTop: '5px', color: '#64748b', fontSize: '11.5px' }}>
                      推荐默认：<strong>{ROLE_CONFIGS[role].defaultName}</strong>，支持点击「↺ 填入默认」或自由编辑。
                    </small>
                  </div>
                </div>

                {/* 角色职责与阶段说明胶囊 */}
                <div
                  style={{
                    marginTop: '16px',
                    padding: '10px 14px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12.5px',
                    color: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <span style={{ fontSize: '16px' }}>{ROLE_CONFIGS[role].badge}</span>
                  <span><strong>阶段职责分工：</strong>{ROLE_CONFIGS[role].desc}</span>
                </div>
              </div>

              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '14px 18px', fontSize: '12.5px', color: '#1e40af', lineHeight: 1.6, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' }}>
                💡 <strong>课时与教学绑定说明：</strong>该成员在项目模板中被选入后，可在各个具体课时分配教学任务。修改职责后，已有历史归档项目不受影响，新确认的项目将按最新配置执行。
              </div>

              {/* 导师角色准则说明卡片 */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', fontSize: '12px', color: '#475569', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' }}>
                <strong style={{ display: 'block', fontSize: '13px', color: '#0f172a', marginBottom: '8px' }}>
                  📌 导师角色配置准则
                </strong>
                <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px', lineHeight: 1.5 }}>
                  <li>每个导师团队必须指定一位「总负责人 / 队长」统领课时主线。</li>
                  <li>原理教练应具备苏格拉底导学能力，在 TheoryMastered 门禁前充分启发。</li>
                  <li>探究向导应挂载对应的物理探究仿真 MCP 及相关对比实验技能。</li>
                  <li>评审导师负责结项作品 CER 质量量规评价与答辩 challenge。</li>
                </ul>
              </div>
            </div>

            {/* 右列：系统设定与引导提示词 (System Prompt)，纵向撑满 */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 20px', display: 'flex', flexDirection: 'column', minHeight: '480px', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#0f172a', fontWeight: 600 }}>
                  2. 系统设定与引导提示词 (System Prompt)
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  {instructions.length} 字符
                </span>
              </div>
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#64748b' }}>
                定义该导师的苏格拉底教学风格、提问梯度及对学生卡顿的启发策略。修改后直接保存生效。
              </p>
              <textarea
                value={instructions}
                disabled={saving}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="输入该助手的系统指令与引导原则..."
                style={{
                  width: '100%',
                  flex: 1,
                  minHeight: '380px',
                  padding: '12px 14px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                  background: '#f8fafc',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />

              {/* 快捷插入教学规范 Snippets */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>快捷插入规范：</span>
                <button
                  type="button"
                  onClick={() => setInstructions((prev) => (prev ? `${prev}\n\n【教学原则】坚持苏格拉底式提问，通过引导性问题启发学生自主分析，不直接给出推导答案。` : '【教学原则】坚持苏格拉底式提问，通过引导性问题启发学生自主分析，不直接给出推导答案。'))}
                  style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}
                >
                  + 苏格拉底启发式追问
                </button>
                <button
                  type="button"
                  onClick={() => setInstructions((prev) => (prev ? `${prev}\n\n【前概念诊断】在探究前先探查学生已有认知迷思，针对错误前概念设计认知冲突。` : '【前概念诊断】在探究前先探查学生已有认知迷思，针对错误前概念设计认知冲突。'))}
                  style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}
                >
                  + 迷思概念前置探查
                </button>
                <button
                  type="button"
                  onClick={() => setInstructions((prev) => (prev ? `${prev}\n\n【论证标准】严格审查主张（Claim）、证据（Evidence）与推理（Reasoning）的闭环。` : '【论证标准】严格审查主张（Claim）、证据（Evidence）与推理（Reasoning）的闭环。'))}
                  style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}
                >
                  + CER 科学论证要求
                </button>
                <button
                  type="button"
                  onClick={() => setInstructions((prev) => (prev ? `${prev}\n\n【实验指导】引导学生在单缝衍射与微粒散射仿真中坚持单变量对比原则，严防混淆变量。` : '【实验指导】引导学生在单缝衍射与微粒散射仿真中坚持单变量对比原则，严防混淆变量。'))}
                  style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}
                >
                  + 控制变量对比实验
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===================== TAB 2: 核心能力与模型配置（顶栏底座+三列能力授权矩阵） ===================== */}
        {tab === 'capabilities' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* 顶栏：推理底座与知识中心关联 (单卡双列，充实紧凑) */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '16px 20px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                gap: '20px',
                alignItems: 'center',
              }}
            >
              {/* 左侧：大语言模型底座 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <h3 style={{ margin: 0, fontSize: '14.5px', color: '#0f172a', fontWeight: 600 }}>
                    1. 大语言模型底座 (LLM Model)
                  </h3>
                  <Link
                    href="/settings/model-providers"
                    style={{ fontSize: '12px', color: '#2563eb', textDecoration: 'none' }}
                  >
                    管理模型供应商 →
                  </Link>
                </div>
                <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#64748b' }}>
                  为该导师指定负责对话推理的底层模型。支持即选即改，无需离开团队管理界面。
                </p>
                <select
                  value={selectedModelKey}
                  disabled={saving}
                  onChange={(e) => setSelectedModelKey(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontSize: '13px',
                    background: '#ffffff',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="">跟随团队/默认全局模型</option>
                  {configuredModels.map((m) => {
                    const key = configuredModelKey(m);
                    return (
                      <option key={key} value={key}>
                        {m.name || m.id} ({m.providerName || m.providerId})
                      </option>
                    );
                  })}
                </select>
                {selectedModelKey && (
                  <div style={{ marginTop: '5px', fontSize: '12px', color: '#15803d', fontWeight: 500 }}>
                    ✓ 当前底座：{configuredModelLabel(selectedModelKey, configuredModels)}
                  </div>
                )}
              </div>

              {/* 右侧：知识中心与教学资产关联 */}
              <div style={{ borderLeft: '1px solid #f1f5f9', paddingLeft: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <h3 style={{ margin: 0, fontSize: '14.5px', color: '#0f172a', fontWeight: 600 }}>
                    2. 知识中心与教学资产关联
                  </h3>
                  <Link
                    href="/settings/knowledge"
                    style={{ fontSize: '12px', color: '#2563eb', textDecoration: 'none' }}
                  >
                    知识中心 →
                  </Link>
                </div>
                <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#64748b', lineHeight: 1.4 }}>
                  导师使用已授权的 <code>knowledge_search</code> 工具按课时范围检索资料。
                </p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <Link
                    href="/settings/knowledge"
                    style={{
                      padding: '6px 12px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      color: '#334155',
                      fontSize: '12px',
                      textDecoration: 'none',
                      background: '#f8fafc',
                      fontWeight: 500,
                    }}
                  >
                    📚 管理资料库
                  </Link>
                  <Link
                    href="/settings/knowledge"
                    style={{
                      padding: '6px 12px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      color: '#334155',
                      fontSize: '12px',
                      textDecoration: 'none',
                      background: '#f8fafc',
                      fontWeight: 500,
                    }}
                  >
                    📑 查看已审核课件
                  </Link>
                </div>
              </div>
            </div>

            {/* 下部：导师三大能力授权矩阵（Skills · MCP · Built-in Tools 并行排版，饱满自适应） */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', alignItems: 'stretch' }}>
              {/* 3. 挂载 Skill 教学技能库 */}
              <CapabilityMatrixColumn
                label="3. 挂载 Skill 教学技能库"
                countBadge={`${enabledSkills.length} / ${availableSkills.length} 已启用`}
                hint="勾选专业导学包（如苏格拉底导学、CER 科学论证、实验设计等）。"
                items={availableSkills}
                selectedIds={enabledSkills}
                onChange={setEnabledSkills}
                colorTheme="blue"
                actionLink={{ href: '/settings/skills', label: '平台技能中心 →' }}
                searchPlaceholder="搜索技能名称或描述..."
              />

              {/* 4. 授权外部 MCP 服务 */}
              <CapabilityMatrixColumn
                label="4. 授权外部 MCP 服务"
                countBadge={`${mcpServerIds.length} / ${availableMcpServers.length} 已授权`}
                hint="授权挂载外部 MCP 服务（如物理仿真实验内核、文献抓取检索等）。"
                items={availableMcpServers}
                selectedIds={mcpServerIds}
                onChange={setMcpServerIds}
                colorTheme="purple"
                actionLink={{ href: '/settings/tools', label: 'MCP 节点管理 →' }}
                searchPlaceholder="搜索 MCP 服务名称..."
              />

              {/* 5. 平台受控运行时内置工具 */}
              <CapabilityMatrixColumn
                label="5. 平台受控运行时内置工具"
                countBadge={`${toolIds.length} / ${availableTools.length} 已授权`}
                hint="控制知识库检索、掌握度查询、理论门禁考核等调用权限。"
                items={availableTools}
                selectedIds={toolIds}
                onChange={setToolIds}
                colorTheme="green"
                actionLink={{ href: '/settings/tools', label: '工具授权中心 →' }}
                searchPlaceholder="搜索内置工具名称..."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// 导师核心能力全景矩阵列 (Capability Matrix Column)
// ----------------------------------------------------------------------
interface CapabilityMatrixColumnProps {
  label: string;
  countBadge: string;
  actionLink?: { href: string; label: string };
  hint: string;
  items: Array<{ id: string; name?: string; label?: string; desc?: string | null }>;
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
  colorTheme: 'blue' | 'purple' | 'green';
  searchPlaceholder?: string;
}

function CapabilityMatrixColumn({
  label,
  countBadge,
  actionLink,
  hint,
  items,
  selectedIds,
  onChange,
  colorTheme,
  searchPlaceholder = '搜索...',
}: CapabilityMatrixColumnProps) {
  const [search, setSearch] = useState('');

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((it) => {
      const text = `${it.id} ${it.name || it.label || ''} ${it.desc || ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [items, search]);

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectAllFiltered = () => {
    const next = new Set([...selectedIds, ...filteredItems.map((it) => it.id)]);
    onChange(Array.from(next));
  };

  const clearAll = () => {
    onChange([]);
  };

  const themeColors = {
    blue: { primary: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
    purple: { primary: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9' },
    green: { primary: '#059669', bg: '#f0fdf4', border: '#a7f3d0', text: '#047857' },
  }[colorTheme];

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        minHeight: '480px',
        maxHeight: '560px',
        overflow: 'hidden',
      }}
    >
      {/* 头部标题与外链 */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>{label}</h3>
            <span
              style={{
                fontSize: '11px',
                padding: '1px 8px',
                borderRadius: '999px',
                background: themeColors.bg,
                color: themeColors.text,
                border: `1px solid ${themeColors.border}`,
                fontWeight: 600,
              }}
            >
              {countBadge}
            </span>
          </div>
          {actionLink && (
            <Link href={actionLink.href} style={{ fontSize: '11.5px', color: '#2563eb', textDecoration: 'none' }}>
              {actionLink.label}
            </Link>
          )}
        </div>
        <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>{hint}</p>

        {/* 搜索框与全选/清空工具条 */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                width: '100%',
                padding: '6px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '12px',
                background: '#f8fafc',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  fontSize: '13px',
                }}
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={selectAllFiltered}
            style={{
              fontSize: '11px',
              padding: '4px 8px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              cursor: 'pointer',
              color: '#334155',
              whiteSpace: 'nowrap',
            }}
          >
            全选
          </button>
          <button
            type="button"
            onClick={clearAll}
            style={{
              fontSize: '11px',
              padding: '4px 8px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '4px',
              cursor: 'pointer',
              color: '#dc2626',
              whiteSpace: 'nowrap',
            }}
          >
            清空
          </button>
        </div>
      </div>

      {/* 选项滚动列表 (纵向充满，可流畅浏览每个能力卡片与说明) */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {filteredItems.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
            未找到匹配项目
          </div>
        ) : (
          filteredItems.map((item) => {
            const isChecked = selectedIds.includes(item.id);
            return (
              <label
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: isChecked ? themeColors.bg : '#ffffff',
                  border: isChecked ? `1px solid ${themeColors.border}` : '1px solid #f1f5f9',
                  cursor: 'pointer',
                  transition: 'background 0.12s ease',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleOne(item.id)}
                  style={{
                    marginTop: '2px',
                    accentColor: themeColors.primary,
                    width: '15px',
                    height: '15px',
                    cursor: 'pointer',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <strong
                      style={{
                        fontSize: '12.5px',
                        color: isChecked ? themeColors.text : '#0f172a',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {item.name || item.label || item.id}
                    </strong>
                    {isChecked && (
                      <span style={{ fontSize: '10.5px', color: themeColors.primary, fontWeight: 600 }}>
                        ✓ 已启用
                      </span>
                    )}
                  </div>
                  {item.desc && (
                    <span style={{ display: 'block', color: '#64748b', fontSize: '11px', marginTop: '2px', lineHeight: 1.4 }}>
                      {item.desc}
                    </span>
                  )}
                </div>
              </label>
            );
          })
        )}
      </div>

      {/* 底部摘要区 (带已选计数) */}
      <div
        style={{
          padding: '8px 14px',
          background: '#f8fafc',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '11.5px',
          color: '#64748b',
        }}
      >
        <span>
          已启用 <strong style={{ color: themeColors.text }}>{selectedIds.length}</strong> / {items.length} 项
        </span>
        {selectedIds.length > 0 && (
          <span style={{ color: '#059669', fontWeight: 500 }}>
            ✓ 权限已配齐
          </span>
        )}
      </div>
    </div>
  );
}
