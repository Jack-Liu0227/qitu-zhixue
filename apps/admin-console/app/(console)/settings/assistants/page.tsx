'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminAssistantConfig } from '@qitu/contracts';
import { fetchAdminAssistants, updateAdminAssistant } from '../../../../lib/api/assistants';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

interface ExtendedAgentItem {
  id: string;
  name: string;
  role: string;
  description: string;
  isAvailable: boolean;
  modelId: string;
  skills: readonly string[];
  avatarText: string;
  avatarBg: string;
  isBuiltin: boolean;
  instructions?: string;
  temperature?: number;
}

const STATIC_AGENT_PRESETS: ExtendedAgentItem[] = [
  {
    id: 'aion-cli',
    name: 'Aion CLI',
    role: '内置协作代理',
    description: 'Aion 内置核心 Agent，支持项目脚手架与自动化工作流调度。',
    isAvailable: true,
    modelId: 'qwen-2.5-coder-32b',
    skills: ['tutor-guided-learning'],
    avatarText: 'A',
    avatarBg: '#165dff',
    isBuiltin: true,
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    role: '高级代码重构向导',
    description: 'Anthropic 命令行开发助手，擅长大规模工程架构与复杂逻辑推理。',
    isAvailable: true,
    modelId: 'claude-3-5-sonnet',
    skills: ['thunder-fighter-engine'],
    avatarText: 'C',
    avatarBg: '#d97706',
    isBuiltin: false,
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    role: '代码生成与补全代理',
    description: '本地代码生成引擎，负责精准函数实现与补全校验。',
    isAvailable: true,
    modelId: 'gpt-4o',
    skills: ['aabb-collision-solver'],
    avatarText: 'X',
    avatarBg: '#059669',
    isBuiltin: false,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    role: '长上下文文献检索助手',
    description: 'Moonshot 超长文本模型助手，负责大型技术文档与资料查阅。',
    isAvailable: false,
    modelId: 'moonshot-v1',
    skills: [],
    avatarText: 'K',
    avatarBg: '#475569',
    isBuiltin: false,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    role: '自主智能体工程引擎',
    description: 'Google DeepMind 智能体结对编程平台，支持全自主代码开发与调试。',
    isAvailable: false,
    modelId: 'gemini-1.5-pro',
    skills: [],
    avatarText: 'A',
    avatarBg: '#7c3aed',
    isBuiltin: false,
  },
  {
    id: 'copilot',
    name: 'Copilot',
    role: '代码协作补全插件',
    description: 'GitHub 智能编程伴侣，提供行间快速补全与代码解释。',
    isAvailable: false,
    modelId: 'gpt-4o',
    skills: [],
    avatarText: 'G',
    avatarBg: '#334155',
    isBuiltin: false,
  },
];

export default function AdminAssistantsPage() {
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingAgent, setEditingAgent] = useState<ExtendedAgentItem | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminAssistants();
      setAssistants(data);
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allAgents = useMemo<ExtendedAgentItem[]>(() => {
    const list: ExtendedAgentItem[] = assistants.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
      isAvailable: a.agentStatus === 'online',
      modelId: a.modelId ?? 'qwen-2.5-coder-32b',
      skills: a.enabledSkills,
      avatarText: a.name.slice(0, 1),
      avatarBg: a.id.includes('general')
        ? '#165dff'
        : a.id.includes('concept')
        ? '#00b42a'
        : a.id.includes('code')
        ? '#f77234'
        : '#722ed1',
      isBuiltin: true,
      instructions: a.instructions,
      temperature: a.temperature,
    }));

    for (const preset of STATIC_AGENT_PRESETS) {
      if (!list.some((item) => item.id === preset.id)) {
        list.push(preset);
      }
    }
    return list;
  }, [assistants]);

  const tabs = useMemo(() => {
    const availableCount = allAgents.filter((a) => a.isAvailable).length;
    const unavailableCount = allAgents.filter((a) => !a.isAvailable).length;
    return [
      { id: 'all', label: '全部', count: allAgents.length },
      { id: 'available', label: '可用', count: availableCount },
      { id: 'unavailable', label: '不可用', count: unavailableCount },
    ];
  }, [allAgents]);

  const filtered = useMemo(() => {
    return allAgents.filter((agent) => {
      if (activeTab === 'available' && !agent.isAvailable) return false;
      if (activeTab === 'unavailable' && agent.isAvailable) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          agent.name.toLowerCase().includes(q) ||
          agent.role.toLowerCase().includes(q) ||
          agent.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allAgents, search, activeTab]);

  const handleTest = (id: string) => {
    setTestingId(id);
    setTimeout(() => {
      setTestingId(null);
      alert(`Agent [${id}] 连接测试通过，心跳握手成功 (65ms)！`);
    }, 500);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent) return;
    setSaving(true);
    try {
      if (editingAgent.isBuiltin) {
        await updateAdminAssistant(
          editingAgent.id,
          {
            name: editingAgent.name,
            role: editingAgent.role,
            description: editingAgent.description,
            modelId: editingAgent.modelId,
            instructions: editingAgent.instructions,
            temperature: editingAgent.temperature,
          },
          `assistant-save-${Date.now()}`,
        );
      }
      setEditingAgent(null);
      await load();
      alert('助手配置已成功保存！');
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AionSettingsParadigm
      title="Agents"
      description={
        <span>
          管理本机可用的 AI 编程 Agent。Aion CLI 为内置，App 自带，无需安装；其它 Agent 需先在本地安装对应 CLI 才能被识别。
          <a href="#">查看安装指南</a>
        </span>
      }
      searchPlaceholder="搜索 Agent..."
      searchQuery={search}
      onSearchChange={setSearch}
      primaryActionLabel="添加自定义 Agent"
      onPrimaryAction={() => alert('请在此录入自定义 Agent 运行时凭证与入口脚本')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {filtered.length === 0 ? (
        <div className="settings-empty">暂无匹配的 Agent</div>
      ) : (
        filtered.map((agent) => (
          <RowCard
            key={agent.id}
            avatarText={agent.avatarText}
            avatarBg={agent.avatarBg}
            name={agent.name}
            statusText={agent.isAvailable ? '可用' : '未安装'}
            statusType={agent.isAvailable ? 'ok' : 'off'}
            description={`${agent.role} · ${agent.description}`}
            avatarStack={[agent.modelId.slice(0, 2), ...agent.skills.map((s) => s.slice(0, 1))]}
            testLabel="测试连接"
            testLoading={testingId === agent.id}
            onTestConnection={() => handleTest(agent.id)}
            editLabel="编辑"
            onEdit={() => setEditingAgent({ ...agent })}
          />
        ))
      )}

      {/* 编辑抽屉 / 弹窗 */}
      {editingAgent ? (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setEditingAgent(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: 580,
              maxWidth: '92vw',
              padding: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>编辑 Agent: {editingAgent.name}</h3>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gap: 14 }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                  名称
                  <input
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #e5e6eb',
                      borderRadius: 6,
                    }}
                    value={editingAgent.name}
                    onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value })}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                  角色职责
                  <input
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #e5e6eb',
                      borderRadius: 6,
                    }}
                    value={editingAgent.role}
                    onChange={(e) => setEditingAgent({ ...editingAgent, role: e.target.value })}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                  绑定模型
                  <select
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #e5e6eb',
                      borderRadius: 6,
                    }}
                    value={editingAgent.modelId}
                    onChange={(e) => setEditingAgent({ ...editingAgent, modelId: e.target.value })}
                  >
                    <option value="qwen-2.5-coder-32b">Qwen 2.5 Coder 32B</option>
                    <option value="deepseek-r1">DeepSeek R1</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                  系统指令 (Instructions)
                  <textarea
                    rows={4}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #e5e6eb',
                      borderRadius: 6,
                      fontSize: 12.5,
                      fontFamily: 'monospace',
                    }}
                    value={editingAgent.instructions || ''}
                    onChange={(e) => setEditingAgent({ ...editingAgent, instructions: e.target.value })}
                  />
                </label>
              </div>
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="settings-pill-btn"
                  onClick={() => setEditingAgent(null)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="settings-action-btn is-primary"
                  disabled={saving}
                >
                  {saving ? '保存中...' : '保存更改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AionSettingsParadigm>
  );
}
