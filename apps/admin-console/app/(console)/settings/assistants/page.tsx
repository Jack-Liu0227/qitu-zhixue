'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminAssistantConfig, AdminAssistantCreateInput, AdminAssistantUpdateInput } from '@qitu/contracts';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import {
  createIdempotentRetryKey,
  AdminApiError,
} from '../../../../lib/api/types';
import { createAdminAssistant, fetchAdminAssistants, updateAdminAssistant } from '../../../../lib/api/assistants';
import { WriteErrorPanel } from '../../../../components/settings/WriteErrorPanel';
import { NetworkOfflineBanner, useBrowserOnline } from '../../../../components/settings/NetworkOffline';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

/**
 * 「助手」表（设置页左侧第一张表，位置/名称/层级为冻结信息架构，保持不变）。
 *
 * 数据来源只有真实接口 `GET /api/v1/admin/ai-runtime/assistants`；
 * 已删除旧版「API 失败 → 内置常量兜底」的静默回退。五种可见状态：
 *  - loading   → AdminStateViews（骨架屏）
 *  - empty     → EmptyAssistantsPanel（接口成功但列表为空）
 *  - error     → AdminStateViews（ErrorState，含服务端错误码）
 *  - 断网      → NetworkOfflineBanner + AdminOfflineError → OfflineBanner
 *  - 权限失败  → AdminPermissionError → 「权限不足」ErrorState（按服务端结果渲染）
 * 写操作（POST/PATCH）带 `Idempotency-Key`，失败重试复用同一键。
 */

// —— 表单选项常量（纯展示用候选项，不是列表数据源）——
const AVAILABLE_MODELS = [
  { id: 'qwen-2.5-coder-32b', label: 'Qwen 2.5 Coder 32B (推荐本地加速)' },
  { id: 'deepseek-r1', label: 'DeepSeek R1 (深度思考推演)' },
  { id: 'gpt-4o', label: 'GPT-4o (全能旗舰模型)' },
  { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet (架构代码王者)' },
  { id: 'moonshot-v1', label: 'Moonshot Kimi (长上下文检索)' },
  { id: 'glm-4', label: 'GLM-4 (智谱多模态旗舰)' },
];

const ALL_SKILLS = [
  { id: 'tutor-guided-learning', label: '苏格拉底启导式教学 (tutor-guided-learning)' },
  { id: 'thunder-fighter-engine', label: '战机物理运动引擎 (thunder-fighter-engine)' },
  { id: 'aabb-collision-solver', label: 'AABB 碰撞检测算法求解器 (aabb-collision-solver)' },
  { id: 'pbl-deliverable-qa', label: 'PBL 交付品质质检答辩 (pbl-deliverable-qa)' },
];

const ALL_MCPS = [
  { id: 'python-sandbox', label: 'Python 代码执行沙箱 (python-sandbox)' },
  { id: 'project-file-manager', label: '工程工作区管理器 (project-file-manager)' },
  { id: 'image-generation', label: '战机游戏贴图生成 (image-generation)' },
  { id: 'web-research-mcp', label: '学术与技术文档检索 (web-research-mcp)' },
];

const PERMISSION_OPTIONS = [
  { value: 'auto', label: '自动记住上次' },
  { value: 'full', label: '完全执行权限 (自主读写工作区)' },
  { value: 'supervised', label: '监督确认模式 (PBL 教学硬约束标准)' },
  { value: 'readonly', label: '只读分析模式 (禁止直接写入代码)' },
];

/** 编辑表单的工作副本；只包含契约允许客户端写入的字段。 */
interface AssistantDraft {
  /** 空串 = 新建（id 由服务端生成，客户端不得自造）。 */
  id: string;
  name: string;
  role: string;
  description: string;
  avatar: string;
  modelId: string;
  temperature: number;
  permissionValue: string;
  skills: string[];
  mcpIds: string[];
  instructions: string;
  teamSelectable: boolean;
  enabled: boolean;
  source: AdminAssistantConfig['source'];
}

function toDraft(config: AdminAssistantConfig): AssistantDraft {
  return {
    id: config.id,
    name: config.name,
    role: config.role,
    description: config.description,
    avatar: config.avatar ?? config.name.slice(0, 1),
    modelId: config.modelId ?? '',
    temperature: config.temperature ?? 0.2,
    permissionValue: config.defaults.permission.value ?? 'auto',
    skills: [...config.enabledSkills],
    mcpIds: [...config.mcpServerIds],
    instructions: config.instructions,
    teamSelectable: config.teamSelectable,
    enabled: config.enabled,
    source: config.source,
  };
}

function emptyDraft(): AssistantDraft {
  return {
    id: '',
    name: '',
    role: '领域特化助手',
    description: '',
    avatar: '🤖',
    modelId: '',
    temperature: 0.3,
    permissionValue: 'auto',
    skills: ['tutor-guided-learning'],
    mcpIds: ['project-file-manager'],
    instructions: '# 角色\n你是专属智能助手...\n\n# 工作方式\n- 第一步...\n- 第二步...',
    teamSelectable: true,
    enabled: true,
    source: 'user',
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}

/**
 * 只把「真正改动过的字段」放进 PATCH；空 PATCH 交给服务端拒绝并显示错误码，
 * 前端仅在提交前给出可见提示，不代替服务端做最终判断。
 */
function buildAssistantPatch(
  original: AdminAssistantConfig,
  draft: AssistantDraft,
): AdminAssistantUpdateInput {
  const patch: AdminAssistantUpdateInput = {};
  if (draft.name !== original.name) patch.name = draft.name;
  if (draft.description !== original.description) patch.description = draft.description;
  if (draft.role !== original.role) patch.role = draft.role;
  if (draft.instructions !== original.instructions) patch.instructions = draft.instructions;
  if (draft.avatar !== (original.avatar ?? '')) patch.avatar = draft.avatar;
  if (draft.modelId !== (original.modelId ?? '')) patch.modelId = draft.modelId === '' ? null : draft.modelId;
  if (draft.temperature !== (original.temperature ?? 0.2)) patch.temperature = draft.temperature;
  if (!sameSet(draft.skills, original.enabledSkills)) patch.enabledSkills = draft.skills;
  if (!sameSet(draft.mcpIds, original.mcpServerIds)) patch.mcpServerIds = draft.mcpIds;
  if (draft.permissionValue !== (original.defaults.permission.value ?? 'auto')) {
    // 保留服务端给出的 mode，仅覆盖 value；不发明契约之外的字段。
    patch.defaults = {
      permission: { mode: original.defaults.permission.mode, value: draft.permissionValue },
    };
  }
  if (draft.teamSelectable !== original.teamSelectable) patch.teamSelectable = draft.teamSelectable;
  if (draft.enabled !== original.enabled) patch.enabled = draft.enabled;
  return patch;
}

function buildAssistantCreateInput(draft: AssistantDraft): AdminAssistantCreateInput {
  const input: AdminAssistantCreateInput = {
    name: draft.name,
    description: draft.description,
    role: draft.role,
    instructions: draft.instructions,
    avatar: draft.avatar,
    modelId: draft.modelId === '' ? null : draft.modelId,
    temperature: draft.temperature,
    enabledSkills: draft.skills,
    mcpServerIds: draft.mcpIds,
    defaults: {
      // mode 词汇与服务端种子一致：'auto' = 自动记住上次（可不带 value），'fixed' = 固定默认。
      permission:
        draft.permissionValue === 'auto'
          ? { mode: 'auto' }
          : { mode: 'fixed', value: draft.permissionValue },
    },
    teamSelectable: draft.teamSelectable,
    enabled: draft.enabled,
  };
  return input;
}

export default function AdminAssistantsPage() {
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const online = useBrowserOnline();
  // 幂等重试键：同一份改动（签名相同）在未被服务端确认前，重试复用同一个键。
  const retryKeys = useRef(createIdempotentRetryKey()).current;
  const baselineRef = useRef<AdminAssistantConfig | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchAdminAssistants();
      setAssistants(data);
    } catch (error) {
      // 不再回退到内置常量：失败必须可见，由 AdminStateViews 渲染 error/断网/权限态。
      setAssistants([]);
      setLoadError(error instanceof Error ? error : new Error('助手列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 恢复联网后自动重试，避免停留在断网横幅上。
  const wasOffline = useRef(!online);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      void load();
    }
  }, [online, load]);

  const availableCount = useMemo(
    () => assistants.filter((a) => a.enabled && a.agentStatus !== 'missing').length,
    [assistants],
  );
  const builtinCount = useMemo(
    () => assistants.filter((a) => a.source === 'builtin').length,
    [assistants],
  );
  const customCount = useMemo(
    () => assistants.filter((a) => a.source !== 'builtin').length,
    [assistants],
  );

  const tabs = useMemo(
    () => [
      { id: 'all', label: '全部助手', count: assistants.length },
      { id: 'builtin', label: '系统内置', count: builtinCount },
      { id: 'custom', label: '自定义助手', count: customCount },
      { id: 'available', label: '可用', count: availableCount },
    ],
    [assistants.length, builtinCount, customCount, availableCount],
  );

  const filtered = useMemo(() => {
    return assistants.filter((agent) => {
      if (activeTab === 'available' && !(agent.enabled && agent.agentStatus !== 'missing')) return false;
      if (activeTab === 'builtin' && agent.source !== 'builtin') return false;
      if (activeTab === 'custom' && agent.source === 'builtin') return false;
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
  }, [assistants, search, activeTab]);

  const startCreate = () => {
    baselineRef.current = null;
    setSaveError(null);
    setNotice(null);
    setDraft(emptyDraft());
  };

  const startEdit = (config: AdminAssistantConfig) => {
    baselineRef.current = config;
    setSaveError(null);
    setNotice(null);
    setDraft(toDraft(config));
  };

  const handleSave = async () => {
    if (draft === null) return;
    if (!draft.name.trim()) {
      setNotice('请填写助手名称（服务端要求 1–40 字符）。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      if (draft.id === '') {
        const signature = `create:${JSON.stringify(draft)}`;
        await createAdminAssistant(buildAssistantCreateInput(draft), retryKeys.keyFor(signature));
      } else {
        const original = baselineRef.current;
        if (original === null) throw new Error('编辑基线丢失，请返回列表重新进入。');
        const patch = buildAssistantPatch(original, draft);
        if (Object.keys(patch).length === 0) {
          // 前端只负责显示：这里给提示避免无意义请求；空 PATCH 的服务端拒绝同样会被渲染。
          setNotice('没有任何改动可以保存。');
          return;
        }
        const signature = `patch:${draft.id}:${JSON.stringify(patch)}`;
        await updateAdminAssistant(draft.id, patch, retryKeys.keyFor(signature));
      }
      retryKeys.acknowledge();
      setDraft(null);
      baselineRef.current = null;
      await load();
    } catch (error) {
      // 保存失败：错误码与提示保留在表单里（WriteErrorPanel），幂等键不清除，
      // 用户点击「重试」时复用同一 Idempotency-Key。
      setSaveError(error);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setDraft(null);
    setSaveError(null);
    setNotice(null);
    baselineRef.current = null;
  };

  // -------------------------------------------------------------
  // 编辑 / 新建视图
  // -------------------------------------------------------------
  if (draft !== null) {
    const isNew = draft.id === '';
    const collapsed = {
      identity: false,
      defaults: false,
      rules: false,
      multica: false,
    };
    return (
      <div style={{ maxWidth: '820px', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: '14px',
            borderBottom: '1px solid #e5e6eb',
            marginBottom: '18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button type="button" className="settings-action-btn" onClick={cancelEdit}>
              ← 全部助手
            </button>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1d2129' }}>
              {draft.name.trim() || (isNew ? '新建助手' : '助手详情设置')}
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button type="button" className="settings-action-btn" onClick={cancelEdit}>
              取消
            </button>
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? '保存中...' : isNew ? '创建' : '保存'}
            </button>
          </div>
        </div>

        <NetworkOfflineBanner online={online} />
        {saveError !== null && <WriteErrorPanel error={saveError} />}
        {notice !== null && (
          <div
            role="status"
            style={{
              border: '1px solid #bfd4ff',
              background: '#f0f6ff',
              borderRadius: 10,
              padding: '8px 14px',
              margin: '10px 0',
              fontSize: 13,
              color: '#165dff',
            }}
          >
            {notice}
          </div>
        )}

        {/* 卡片 1: 身份 (改动立即生效) */}
        <section className="settings-collapsible-card">
          <header className={`settings-card-header ${collapsed.identity ? 'is-collapsed' : ''}`}>
            <div className="settings-card-title-group">
              <span className="settings-card-title">身份</span>
              <span className="badge-immediate">改动立即生效</span>
            </div>
          </header>
          <div className="settings-card-body">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '18px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '12px',
                    background: '#165dff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    color: '#ffffff',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                >
                  {draft.avatar || '🤖'}
                </div>
                <button
                  type="button"
                  className="settings-pill-btn"
                  style={{ fontSize: '11px', padding: '0 8px', height: '24px' }}
                  onClick={() => {
                    const icons = ['🤖', '📖', '🚀', '⚡', '🎓', '🦊', '🔬', '💡', '🛡️', '💻'];
                    const next = icons[(icons.indexOf(draft.avatar) + 1) % icons.length] ?? '🤖';
                    setDraft({ ...draft, avatar: next });
                  }}
                >
                  更换图标
                </button>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="settings-form-row">
                  <label className="settings-form-label">
                    <span className="req">*</span> 名称
                  </label>
                  <div className="settings-form-content">
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="请输入助手名称，例如：文献与知识地图助手"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </div>
                </div>
                <div className="settings-form-row">
                  <label className="settings-form-label">描述</label>
                  <div className="settings-form-content">
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="一句话职责说明"
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 卡片 2: 默认配置 (仅对新会话生效) */}
        <section className="settings-collapsible-card">
          <header className={`settings-card-header ${collapsed.defaults ? 'is-collapsed' : ''}`}>
            <div className="settings-card-title-group">
              <span className="settings-card-title">默认配置</span>
              <span className="badge-new-session">仅对新会话生效</span>
            </div>
          </header>
          <div className="settings-card-body">
            <div className="settings-form-row">
              <label className="settings-form-label">
                <span style={{ fontSize: '15px' }}>☁️</span> 模型
              </label>
              <div className="settings-form-content">
                <select
                  className="settings-select"
                  value={draft.modelId}
                  onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
                >
                  <option value="">自动（由服务端模型目录解析）</option>
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="settings-hint">最终生效模型以服务端模型注册表为准。</p>
              </div>
            </div>

            <div className="settings-form-row">
              <label className="settings-form-label">
                <span style={{ fontSize: '15px' }}>🛡️</span> 权限默认
              </label>
              <div className="settings-form-content">
                <select
                  className="settings-select"
                  value={draft.permissionValue}
                  onChange={(e) => setDraft({ ...draft, permissionValue: e.target.value })}
                >
                  {PERMISSION_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="settings-hint">这只是会话默认展示项；执行权限的最终判定在服务端。</p>
              </div>
            </div>

            <div className="settings-form-row">
              <label className="settings-form-label">
                <span style={{ fontSize: '15px' }}>⚡</span> 技能
              </label>
              <div className="settings-form-content">
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    padding: '8px',
                    border: '1px solid #e5e6eb',
                    borderRadius: '8px',
                    background: '#fcfcfc',
                  }}
                >
                  {mergeOptions(ALL_SKILLS, draft.skills).map((sk) => {
                    const checked = draft.skills.includes(sk.id);
                    return (
                      <label
                        key={sk.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontSize: '12px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: checked ? '#e8f3ff' : '#ffffff',
                          border: `1px solid ${checked ? '#165dff' : '#e5e6eb'}`,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...draft.skills, sk.id]
                              : draft.skills.filter((s) => s !== sk.id);
                            setDraft({ ...draft, skills: next });
                          }}
                        />
                        <span style={{ color: checked ? '#165dff' : '#4e5969', fontWeight: checked ? 600 : 400 }}>
                          {sk.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <span className="settings-hint">已选 {draft.skills.length} 项技能</span>
              </div>
            </div>

            <div className="settings-form-row">
              <label className="settings-form-label">
                <span style={{ fontSize: '15px' }}>🧰</span> MCP
              </label>
              <div className="settings-form-content">
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    padding: '8px',
                    border: '1px solid #e5e6eb',
                    borderRadius: '8px',
                    background: '#fcfcfc',
                  }}
                >
                  {mergeOptions(ALL_MCPS, draft.mcpIds).map((mcp) => {
                    const checked = draft.mcpIds.includes(mcp.id);
                    return (
                      <label
                        key={mcp.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontSize: '12px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: checked ? '#f0fdf4' : '#ffffff',
                          border: `1px solid ${checked ? '#059669' : '#e5e6eb'}`,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...draft.mcpIds, mcp.id]
                              : draft.mcpIds.filter((s) => s !== mcp.id);
                            setDraft({ ...draft, mcpIds: next });
                          }}
                        />
                        <span style={{ color: checked ? '#059669' : '#4e5969', fontWeight: checked ? 600 : 400 }}>
                          {mcp.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <span className="settings-hint">已选 {draft.mcpIds.length} 项工具与沙箱</span>
              </div>
            </div>
          </div>
        </section>

        {/* 卡片 3: 规则 (仅对新会话生效) */}
        <section className="settings-collapsible-card">
          <header className={`settings-card-header ${collapsed.rules ? 'is-collapsed' : ''}`}>
            <div className="settings-card-title-group">
              <span className="settings-card-title">规则</span>
              <span className="badge-new-session">仅对新会话生效</span>
            </div>
          </header>
          <div className="settings-card-body" style={{ padding: '0' }}>
            <textarea
              className="settings-textarea"
              style={{
                height: '230px',
                border: 'none',
                borderRadius: '0',
                fontFamily: 'monospace',
                fontSize: '12.5px',
                lineHeight: '1.6',
                padding: '14px 18px',
              }}
              placeholder={'# 角色\n你是...\n\n# 工作方式\n- 先明确...'}
              value={draft.instructions}
              onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
            />
          </div>
        </section>

        {/* 卡片 4: Multica 进阶配置 */}
        <section className="settings-collapsible-card">
          <header className={`settings-card-header ${collapsed.multica ? 'is-collapsed' : ''}`}>
            <div className="settings-card-title-group">
              <span className="settings-card-title">Multica 进阶属性</span>
              <span className="badge-advanced">团队协作</span>
            </div>
          </header>
          <div className="settings-card-body">
            <div className="settings-form-row">
              <label className="settings-form-label">角色定位</label>
              <div className="settings-form-content">
                <input
                  type="text"
                  className="settings-input"
                  placeholder="例如：生产流程 Leader / 架构师 / 物理教学教练"
                  value={draft.role}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                />
              </div>
            </div>

            <div className="settings-form-row">
              <label className="settings-form-label">启用状态</label>
              <div className="settings-form-content">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  />
                  允许被会话装载（禁用后服务端不再为其创建运行实例）
                </label>
                <div style={{ marginTop: '6px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={draft.teamSelectable}
                      onChange={(e) => setDraft({ ...draft, teamSelectable: e.target.checked })}
                    />
                    允许在团队配置中被选择（teamSelectable）
                  </label>
                </div>
              </div>
            </div>

            <div className="settings-form-row">
              <label className="settings-form-label">生成温度</label>
              <div className="settings-form-content" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  style={{ flex: 1 }}
                  value={draft.temperature}
                  onChange={(e) => setDraft({ ...draft, temperature: parseFloat(e.target.value) })}
                />
                <span style={{ fontSize: '13px', fontWeight: 600, width: '40px' }}>{draft.temperature}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // -------------------------------------------------------------
  // 列表视图：助手列表（真实 API + 五态）
  // -------------------------------------------------------------
  const listBody = (() => {
    if (loading) {
      return <AdminStateViews loading={true} error={null} onRetry={() => void load()} />;
    }
    if (loadError !== null) {
      // 服务端业务失败：带错误码的可见面板；断网/权限：AdminStateViews。
      if (loadError instanceof AdminApiError) {
        return <WriteErrorPanel error={loadError} onRetry={() => void load()} />;
      }
      return <AdminStateViews loading={false} error={loadError} onRetry={() => void load()} />;
    }
    if (assistants.length === 0) {
      // empty：接口成功但没有数据 —— 可见空态 + 引导新建。
      return (
        <div className="settings-empty" style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: '34px', marginBottom: '10px' }}>🗂️</div>
          <strong style={{ fontSize: '14px', color: '#1d2129' }}>暂无智能助手</strong>
          <p style={{ color: '#4e5969', fontSize: '12.5px', margin: '6px 0 14px' }}>
            服务端助手目录为空。创建第一个助手后即可在团队中选择编排。
          </p>
          <button type="button" className="settings-action-btn is-primary" onClick={startCreate}>
            新建助手
          </button>
        </div>
      );
    }
    if (filtered.length === 0) {
      return <div className="settings-empty">暂无匹配的智能助手</div>;
    }
    return filtered.map((agent) => {
      const available = agent.enabled && agent.agentStatus !== 'missing';
      return (
        <RowCard
          key={agent.id}
          avatarText={agent.avatar || agent.name.slice(0, 1)}
          avatarBg={
            agent.id.includes('general')
              ? '#165dff'
              : agent.id.includes('concept')
              ? '#059669'
              : agent.id.includes('code')
              ? '#f77234'
              : '#722ed1'
          }
          name={agent.name}
          statusText={
            !agent.enabled
              ? '已停用'
              : agent.source === 'builtin'
              ? '系统内置'
              : available
              ? '自定义 · 在线'
              : '自定义 · 待确认'
          }
          statusType={!agent.enabled ? 'off' : agent.source === 'builtin' ? 'ok' : available ? 'custom' : 'muted'}
          description={`${agent.role} · ${agent.description}`}
          avatarStack={[
            ...(agent.modelId ? [agent.modelId.slice(0, 2)] : []),
            ...agent.enabledSkills.map((s) => s.slice(0, 1)),
          ]}
          editLabel="编辑设置"
          onEdit={() => startEdit(agent)}
        />
      );
    });
  })();

  return (
    <>
      <NetworkOfflineBanner online={online} onRetry={() => void load()} />
      <AionSettingsParadigm
        title="智能助手"
        description={
          <span>
            管理启途智学平台智能助手与 PBL 导师。支持通过自己的 Agent SDK 定义会话、执行门禁与团队编排，亦可参考 Multica 格式自定义助手。
          </span>
        }
        searchPlaceholder="搜索助手名称、定位、技能..."
        searchQuery={search}
        onSearchChange={setSearch}
        primaryActionLabel="新建助手"
        onPrimaryAction={startCreate}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {listBody}
      </AionSettingsParadigm>
    </>
  );
}

/** 展示候选项 ∪ 服务端已选值（保证真实数据里未知的已选项也可见可取消）。 */
function mergeOptions(
  catalog: readonly { id: string; label: string }[],
  selected: readonly string[],
): { id: string; label: string }[] {
  const known = new Map(catalog.map((c) => [c.id, c]));
  const merged = [...catalog];
  for (const id of selected) {
    if (!known.has(id)) merged.push({ id, label: `${id} (服务端配置)` });
  }
  return merged;
}
