
'use client';

const BUILTIN_TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
  'tutor.context_packet': {
    type: 'object',
    required: ['turnId', 'projectId'],
    properties: {
      turnId: { type: 'string', description: '当前导师对话回合唯一标识' },
      projectId: { type: 'string', description: '绑定的 PBL 项目 UUID' },
      objectiveId: { type: 'string', description: '可选，当前正在攻克的教学排程目标 ID' },
      currentSessionIndex: { type: 'integer', minimum: 1, maximum: 16, description: '当前课时编号' },
      studentResponse: { type: 'string', maxLength: 4000, description: '学生上一轮交互提交的文本或操作回执' },
    },
  },
  'tutor.pedagogy_move': {
    type: 'object',
    required: ['moveType', 'stepIndex'],
    properties: {
      moveType: { type: 'string', enum: ['hint', 'check_question', 'remediation', 'escalation'], description: '苏格拉底教学引导动作类型' },
      stepIndex: { type: 'integer', minimum: 0, description: '提示阶梯序号，逐步降低脚手架' },
      contextObservation: {
        type: 'object',
        description: '引导时所依据的实验测量或代码自检事实',
        properties: {
          metric: { type: 'string', description: '观测指标名' },
          value: { type: 'number', description: '测量数值' },
          unit: { type: 'string', description: '单位' },
        },
      },
    },
  },
  'tutor.mastery_gate': {
    type: 'object',
    required: ['objectiveId', 'studentEvidence'],
    properties: {
      objectiveId: { type: 'string', description: '待判定通关的 TheoryMastered 核心概念标识' },
      studentEvidence: {
        type: 'object',
        required: ['claim', 'reasoning'],
        description: '学生提交的 CER 证据包',
        properties: {
          claim: { type: 'string', description: '学生核心主张' },
          reasoning: { type: 'string', description: '推导逻辑与规律解释' },
          dataRefs: { type: 'array', items: { type: 'string' }, description: '引用的实验测量回执 ID' },
        },
      },
      threshold: { type: 'number', minimum: 0, maximum: 100, description: '判定及格的分数阈值' },
    },
  },
  'tutor.escalation': {
    type: 'object',
    required: ['reason', 'priority'],
    properties: {
      stallDurationMs: { type: 'integer', minimum: 0, description: '学生连续卡顿毫秒数' },
      reason: { type: 'string', description: '升级给班主任的具体原因' },
      priority: { type: 'string', enum: ['normal', 'urgent'], description: '升级紧急度' },
    },
  },
  'agent-memory.index': {
    type: 'object',
    required: ['eventType', 'memoryPayload'],
    properties: {
      eventType: { type: 'string', description: '记忆事件类型' },
      memoryPayload: {
        type: 'object',
        description: '结构化记忆载荷',
        properties: {
          keyInsights: { type: 'array', items: { type: 'string' }, description: '提炼的认知偏好与卡点' },
          sessionScope: { type: 'string', description: '作用课时范围' },
        },
      },
      privacyLevel: { type: 'string', enum: ['desensitized', 'minimal'], description: '脱敏等级' },
    },
  },
  'project.next_step': {
    type: 'object',
    required: ['projectId', 'currentPhase'],
    properties: {
      projectId: { type: 'string', description: '项目 UUID' },
      currentPhase: { type: 'string', description: '当前探究阶段' },
      requireTheoryMastered: { type: 'boolean', description: '是否严格检验 TheoryMastered 门禁' },
    },
  },
  'knowledge_search': {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 2000, description: '检索词或探究问题' },
      topK: { type: 'integer', minimum: 1, maximum: 8, description: '返回相关段落数量上限' },
    },
  },
  'knowledge_read': {
    type: 'object',
    required: ['citationId'],
    properties: {
      citationId: { type: 'string', minLength: 1, maxLength: 2000, description: '检索命中的来源证据唯一标识' },
    },
  },
  'mastery_query': {
    type: 'object',
    properties: {
      studentId: { type: 'string', description: '学生唯一标识' },
      objectiveIds: { type: 'array', items: { type: 'string' }, description: '查询的目标标识列表' },
    },
  },
  'student_profile_get': {
    type: 'object',
    properties: {
      studentId: { type: 'string', description: '学生唯一标识' },
      includeRadar: { type: 'boolean', description: '是否包含能力雷达图分值' },
      includeMilestones: { type: 'boolean', description: '是否包含历史里程碑' },
    },
  },
  'tutor.propose_lesson_activity': {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: { type: 'string', enum: ['board', 'optics', 'choice_question'], description: '活动类型：看板展示/光学实验仿真/选择检验题' },
      title: { type: 'string', maxLength: 100, description: '活动标题' },
      summary: { type: 'string', maxLength: 500, description: '教学活动设计意图' },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        description: '多步骤板书或引导演示',
        items: {
          type: 'object',
          required: ['caption'],
          properties: {
            caption: { type: 'string', maxLength: 300, description: '步骤讲解文本' },
            tex: { type: 'string', maxLength: 500, description: 'KaTeX 数学/物理公式表达式' },
            nodes: {
              type: 'array',
              maxItems: 12,
              description: '拓扑图节点列表',
              items: {
                type: 'object',
                required: ['id', 'label'],
                properties: {
                  id: { type: 'string', description: '节点唯一键' },
                  label: { type: 'string', description: '节点名称' },
                },
              },
            },
            edges: {
              type: 'array',
              maxItems: 20,
              description: '拓扑关系边列表',
              items: {
                type: 'object',
                required: ['from', 'to'],
                properties: {
                  from: { type: 'string', description: '源节点 id' },
                  to: { type: 'string', description: '目标节点 id' },
                },
              },
            },
          },
        },
      },
      mode: { type: 'string', enum: ['diffraction', 'scattering'], description: '微观光学实验模式：单缝衍射 / 细雾室散射' },
      parameters: {
        type: 'object',
        description: '光学物理实验仿真控制入参',
        properties: {
          wavelength: { type: 'number', minimum: 400, maximum: 750, description: '激光波长 (nm，可见光范围 400-750)' },
          slitWidth: { type: 'number', minimum: 10, maximum: 200, description: '单缝宽度 (μm)' },
          screenDistance: { type: 'number', minimum: 0.5, maximum: 2.0, description: '光屏与狭缝距离 (m)' },
          particleRadius: { type: 'number', minimum: 5, maximum: 300, description: '细雾微粒半径 (nm)' },
        },
      },
      question: {
        type: 'object',
        required: ['prompt', 'options', 'correctOptionIndex', 'explanation', 'difficulty', 'sourceRefs'],
        description: '同目标过程性检验题目结构',
        properties: {
          prompt: { type: 'string', maxLength: 2000, description: '题干内容与情境' },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 6,
            description: '备选项列表',
            items: {
              type: 'object',
              required: ['text'],
              properties: {
                text: { type: 'string', maxLength: 500, description: '选项文本' },
              },
            },
          },
          correctOptionIndex: { type: 'integer', minimum: 0, maximum: 5, description: '正确选项索引' },
          explanation: { type: 'string', maxLength: 3000, description: '答案解析与概念纠偏说明' },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: '题目难度' },
          sourceRefs: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' }, description: '教材或证据来源引用' },
        },
      },
    },
  },
  'tutor.propose_courseware_activity': {
    type: 'object',
    required: ['kind', 'origin', 'use'],
    properties: {
      kind: { type: 'string', enum: ['board', 'optics', 'choice_question', 'find_courseware', 'reuse_courseware'], description: '课件复用与交互类型' },
      origin: { type: 'string', enum: ['generated', 'adapted'], description: '课件生成来源' },
      assetVersionId: { type: 'string', maxLength: 160, description: '复用已发布课件的版本 UUID' },
      use: { type: 'string', enum: ['explain', 'demonstrate', 'remediate', 'review'], description: '教学用途阶段' },
      objectiveRefs: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' }, description: '关联的教学目标' },
    },
  },
  'tutor.propose_wave_activity': {
    type: 'object',
    required: ['kind', 'mode'],
    properties: {
      kind: { type: 'string', enum: ['board', 'wave_preview', 'optics', 'choice_question', 'recommendation'], description: '波动光学仿真候选类型' },
      mode: { type: 'string', enum: ['diffraction', 'interference'], description: '单缝衍射 / 双缝干涉' },
      parameters: {
        type: 'object',
        description: '远场物理计算核心参数',
        properties: {
          wavelength: { type: 'number', minimum: 400, maximum: 750, description: '激光波长 (nm)' },
          slitWidth: { type: 'number', minimum: 10, maximum: 200, description: '缝宽 a (μm)' },
          slitSeparation: { type: 'number', minimum: 40, maximum: 400, description: '双缝间距 d (μm)' },
          screenDistance: { type: 'number', minimum: 0.5, maximum: 2.0, description: '屏距 L (m)' },
        },
      },
    },
  },
};

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HierarchicalSchemaViewer } from '../../../../lib/components/HierarchicalSchemaViewer';
import Link from 'next/link';
import type {
  AdminAssistantConfig,
  AdminRuntimeBuiltinTool,
  AdminRuntimeMcpServer,
  AdminRuntimeSnapshot,
  AdminTeamConfig,
  ToolBindingMigrationResult,
} from '@qitu/contracts';
import { LEGACY_TOOL_BINDING_RESOLUTIONS } from '@qitu/contracts';
import { hasMcpBinding, persistAssistantBinding } from '../../../../lib/api/assistantBindings';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import { fetchRuntimeSnapshot } from '../../../../lib/api/runtime';
import { fetchAdminTeamConfigs } from '../../../../lib/api/teams';
import { KnowledgeConfiguration } from '../../../../lib/components/KnowledgeConfiguration';
import { ToolBindingMigrationPanel } from '../../../../lib/components/ToolBindingMigrationPanel';

const IMA_ID = 'ima-knowledge';

const MCP_STATUS_TEXT: Record<AdminRuntimeMcpServer['status'], string> = {
  connected: '连接正常',
  disconnected: '未连接',
  error: '连接异常',
  not_configured: '未配置',
  unknown: '状态未知',
};

const BUILTIN_STATUS_TEXT: Record<AdminRuntimeBuiltinTool['status'], string> = {
  enabled: '已登记',
  disabled: '已停用',
  ready: '可用',
  unavailable: '不可用',
  error: '异常',
  unknown: '未知',
};

const RISK_TEXT: Record<AdminRuntimeBuiltinTool['riskLevel'], string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  unknown: '未知',
};

export default function ToolsSettingsPage() {
  // ---- 运行时快照 ----
  const [snapshot, setSnapshot] = useState<AdminRuntimeSnapshot | null>(null);
  const [registryPending, setRegistryPending] = useState(true);
  const [registryError, setRegistryError] = useState('');

  // ---- 助手与团队 ----
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [teamId, setTeamId] = useState('');
  const [assistantSearch, setAssistantSearch] = useState('');
  const [matrixBusy, setMatrixBusy] = useState(false);
  const operation = useRef(false);
  const [assistantsPending, setAssistantsPending] = useState(true);
  const [assistantsError, setAssistantsError] = useState('');

  // ---- Tab 切换：矩阵 / MCP 列表 / 内置工具 / 配置工作台 ----
  const [activeTab, setActiveTab] = useState<'matrix' | 'mcp' | 'builtin'>('matrix');
  const [expandedBuiltinTools, setExpandedBuiltinTools] = useState<Set<string>>(new Set());
  const [showHelpBanner, setShowHelpBanner] = useState(false);

  const writing = useRef(new Set<string>());
  const registryRequest = useRef(0);
  const assistantRequest = useRef(0);
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeFailed = /失败|未确认|暂不能|不一致/.test(notice);

  const notify = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    if (!/失败|未确认|暂不能|不一致/.test(text)) noticeTimer.current = setTimeout(() => setNotice(''), 3000);
  }, []);

  const loadRegistry = useCallback(async () => {
    const request = ++registryRequest.current;
    setRegistryPending(true);
    try {
      const state = await fetchRuntimeSnapshot();
      if (request !== registryRequest.current) return;
      setSnapshot(state);
      setRegistryError('');
    } catch (err) {
      if (request !== registryRequest.current) return;
      setSnapshot(null);
      setRegistryError(err instanceof Error ? err.message : 'MCP 状态读取失败');
    } finally {
      if (request === registryRequest.current) setRegistryPending(false);
    }
  }, []);

  const loadAssistants = useCallback(async () => {
    const request = ++assistantRequest.current;
    setAssistantsPending(true);
    try {
      const [list, teamList] = await Promise.all([fetchAdminAssistantConfigs(), fetchAdminTeamConfigs()]);
      if (request !== assistantRequest.current) return;
      setAssistants(list ?? []);
      setTeams(teamList);
      setAssistantsError('');
    } catch (err) {
      if (request !== assistantRequest.current) return;
      setAssistants([]);
      setAssistantsError(err instanceof Error ? err.message : '助手列表读取失败');
    } finally {
      if (request === assistantRequest.current) setAssistantsPending(false);
    }
  }, []);

  useEffect(() => {
    void loadRegistry();
    void loadAssistants();
    const refresh = () => void loadRegistry();
    window.addEventListener('qitu-configuration-changed', refresh);
    return () => window.removeEventListener('qitu-configuration-changed', refresh);
  }, [loadRegistry, loadAssistants]);

  const mcpServers = useMemo(
    () => snapshot?.mcpServers.filter((server) => server.id !== IMA_ID) ?? [],
    [snapshot]
  );
  const builtinTools = useMemo(
    () => snapshot?.builtInTools.filter((tool) => tool.invocation !== 'domain_service') ?? [],
    [snapshot]
  );

  const visibleAssistants = useMemo(() => {
    let list = assistants;
    if (teamId) {
      const members = new Set(teams.find((t) => t.id === teamId)?.members.map((m) => m.assistantId) ?? []);
      list = list.filter((a) => members.has(a.id));
    }
    if (assistantSearch.trim()) {
      const q = assistantSearch.trim().toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || (a.role && a.role.toLowerCase().includes(q)));
    }
    return list;
  }, [assistants, teams, teamId, assistantSearch]);

  const matrixDisabled = matrixBusy || registryPending || assistantsPending || !!registryError || !!assistantsError;

  const runOperation = async (run: () => Promise<unknown>) => {
    if (operation.current || matrixDisabled) return;
    operation.current = true;
    setMatrixBusy(true);
    try {
      await run();
    } finally {
      operation.current = false;
      setMatrixBusy(false);
    }
  };

  const unresolvedTools = useMemo(
    () =>
      [...new Set(assistants.flatMap((assistant) => assistant.toolIds))].filter(
        (id) => !snapshot?.builtInTools.some((tool) => tool.id === id)
      ),
    [assistants, snapshot]
  );

  const onToolBindingsMigrated = useCallback(
    async (result: ToolBindingMigrationResult) => {
      const registryIdentity = ++registryRequest.current;
      const assistantIdentity = ++assistantRequest.current;
      setRegistryPending(true);
      setAssistantsPending(true);
      try {
        const [freshSnapshot, freshAssistants] = await Promise.all([
          fetchRuntimeSnapshot(),
          fetchAdminAssistantConfigs(),
        ]);
        if (registryIdentity !== registryRequest.current || assistantIdentity !== assistantRequest.current) {
          throw new Error('列表已刷新，请重新核对迁移结果');
        }
        const known = new Set(freshSnapshot.builtInTools.map((tool) => tool.id));
        const legacy = new Set(LEGACY_TOOL_BINDING_RESOLUTIONS.map((tool) => tool.id));
        if (
          freshAssistants.some((assistant) =>
            assistant.toolIds.some((id) => legacy.has(id) && !known.has(id))
          )
        ) {
          throw new Error('服务端仍返回已识别的历史绑定');
        }
        setSnapshot(freshSnapshot);
        setAssistants(freshAssistants);
        setRegistryError('');
        setAssistantsError('');
        notify(`已迁移 ${result.migratedAssistantIds.length} 个助手的 ${result.retiredBindingCount} 项历史绑定，已记录审计并回读确认`);
      } catch (cause) {
        notify(`迁移已提交，但回读未确认，请刷新核对：${cause instanceof Error ? cause.message : '读取失败'}`);
        throw cause;
      } finally {
        if (registryIdentity === registryRequest.current) setRegistryPending(false);
        if (assistantIdentity === assistantRequest.current) setAssistantsPending(false);
      }
    },
    [notify]
  );

  const applyAssistantPatch = useCallback(
    async (assistantId: string, field: 'mcpServerIds' | 'toolIds', next: string[]): Promise<boolean> => {
      if (!snapshot || registryPending || registryError || assistantsPending || assistantsError) {
        notify('目录或助手状态未完成读取，暂不能修改授权');
        return false;
      }
      if (writing.current.has(assistantId)) {
        notify('该助手的上一项授权仍在保存和回读');
        return false;
      }
      writing.current.add(assistantId);
      ++assistantRequest.current;
      try {
        await persistAssistantBinding(assistantId, field, next);
        const fresh = (await fetchAdminAssistantConfigs()).find((item) => item.id === assistantId);
        const expected = [...new Set(next)].sort();
        if (!fresh || JSON.stringify([...new Set(fresh[field])].sort()) !== JSON.stringify(expected)) {
          throw new Error('服务端回读与请求不一致，请刷新后核对');
        }
        setAssistants((prev) => prev.map((item) => (item.id === assistantId ? fresh : item)));
        return true;
      } catch (err) {
        const label = assistants.find((a) => a.id === assistantId)?.name ?? assistantId;
        notify(
          `【${label} · ${field === 'toolIds' ? '内置工具' : 'MCP'}】写入或回读失败：${
            err instanceof Error ? err.message : '未知错误'
          }。本项状态未确认。`
        );
        return false;
      } finally {
        writing.current.delete(assistantId);
      }
    },
    [snapshot, registryPending, registryError, assistantsPending, assistantsError, assistants, notify]
  );

  const isMcpBound = useCallback((assistant: AdminAssistantConfig, server: AdminRuntimeMcpServer) => {
    return hasMcpBinding(assistant, { id: server.id, name: server.label });
  }, []);

  const isBuiltinBound = useCallback((assistant: AdminAssistantConfig, tool: AdminRuntimeBuiltinTool) => {
    return assistant.toolIds.includes(tool.id);
  }, []);

  const toggleMcpForAssistant = useCallback(
    async (server: AdminRuntimeMcpServer, assistant: AdminAssistantConfig) => {
      const bound = isMcpBound(assistant, server);
      if (!bound && (!server.enabled || server.status !== 'connected')) {
        notify('此服务尚未连接，请先完成服务配置和连接检查。');
        return;
      }
      const next = bound
        ? assistant.mcpServerIds.filter((v) => v !== server.id && v !== server.label)
        : [...assistant.mcpServerIds, server.id];
      const ok = await applyAssistantPatch(assistant.id, 'mcpServerIds', next);
      if (ok) notify(`已${bound ? '取消' : '更新'}【${assistant.name}】对 MCP【${server.label}】的授权`);
    },
    [isMcpBound, applyAssistantPatch, notify]
  );

  const toggleBuiltinForAssistant = useCallback(
    async (tool: AdminRuntimeBuiltinTool, assistant: AdminAssistantConfig) => {
      const bound = isBuiltinBound(assistant, tool);
      const next = bound
        ? assistant.toolIds.filter((v) => v !== tool.id)
        : [...assistant.toolIds, tool.id];
      const ok = await applyAssistantPatch(assistant.id, 'toolIds', next);
      if (ok) notify(`已${bound ? '取消' : '更新'}【${assistant.name}】对内置工具【${tool.label}】的授权`);
    },
    [isBuiltinBound, applyAssistantPatch, notify]
  );

  const setMcpColumnForAll = useCallback(
    async (server: AdminRuntimeMcpServer, enabled: boolean) => {
      if (assistants.length === 0) return;
      for (const assistant of visibleAssistants) {
        const bound = hasMcpBinding(assistant, { id: server.id, name: server.label });
        if (bound === enabled) continue;
        const next = enabled
          ? [...assistant.mcpServerIds, server.id]
          : assistant.mcpServerIds.filter((v) => v !== server.id && v !== server.label);
        const ok = await applyAssistantPatch(assistant.id, 'mcpServerIds', next);
        if (!ok) return;
      }
      notify(enabled ? `已批量为当前助手开启 MCP【${server.label}】` : `已清空当前助手对 MCP【${server.label}】的授权`);
    },
    [visibleAssistants, applyAssistantPatch, notify, assistants.length]
  );

  const setBuiltinColumnForAll = useCallback(
    async (tool: AdminRuntimeBuiltinTool, enabled: boolean) => {
      for (const assistant of visibleAssistants) {
        const bound = assistant.toolIds.includes(tool.id);
        if (bound === enabled) continue;
        const next = enabled
          ? [...assistant.toolIds, tool.id]
          : assistant.toolIds.filter((v) => v !== tool.id);
        const ok = await applyAssistantPatch(assistant.id, 'toolIds', next);
        if (!ok) return;
      }
      notify(enabled ? `已批量开启【${tool.label}】` : `已清空对【${tool.label}】的授权`);
    },
    [visibleAssistants, applyAssistantPatch, notify]
  );

  const setAssistantRow = useCallback(
    async (assistant: AdminAssistantConfig, enabled: boolean) => {
      const nextMcp = enabled
        ? Array.from(new Set([...assistant.mcpServerIds, ...mcpServers.filter((s) => s.enabled && s.status === 'connected').map((s) => s.id)]))
        : assistant.mcpServerIds.filter((v) => !mcpServers.some((s) => s.id === v || s.label === v));
      const okMcp = await applyAssistantPatch(assistant.id, 'mcpServerIds', nextMcp);
      if (!okMcp) return false;
      const nextTools = enabled
        ? Array.from(new Set([...assistant.toolIds, ...builtinTools.map((t) => t.id)]))
        : assistant.toolIds.filter((v) => !builtinTools.some((t) => t.id === v));
      const okTools = await applyAssistantPatch(assistant.id, 'toolIds', nextTools);
      if (!okTools) return false;
      notify(enabled ? `已为【${assistant.name}】开启可见工具授权` : `已清空【${assistant.name}】的授权`);
      return true;
    },
    [mcpServers, builtinTools, applyAssistantPatch, notify]
  );

  const setEntireMatrix = useCallback(
    async (enabled: boolean) => {
      for (const assistant of visibleAssistants) {
        if (!(await setAssistantRow(assistant, enabled))) return;
      }
    },
    [visibleAssistants, setAssistantRow]
  );

  const loading = (registryPending && !snapshot) || assistantsPending;

  return (
    <div className="admin-settings-page" style={{ paddingBottom: '32px' }}>
      {/* 紧凑页头 */}
      <div className="admin-page-header" style={{ marginBottom: '12px' }}>
        <div className="admin-page-header-title">
          <div>
            <h1>工具与 MCP 配置中心</h1>
            <p>
              集中维护 AI 智能体授权矩阵、MCP 外部服务器节点与内置工具集。授权持久化即时同步服务端。
            </p>
          </div>
        </div>
        <div className="admin-page-header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="settings-action-btn"
            onClick={() => {
              void loadRegistry();
              void loadAssistants();
            }}
          >
            🔄 刷新状态
          </button>
          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={() => setActiveTab('mcp')}
          >
            + 添加 MCP
          </button>
        </div>
      </div>

      {/* 统一 Tab 栏 */}
      <div className="settings-tabs-row" role="tablist" style={{ marginBottom: '14px' }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'matrix'}
          className={`settings-tab-btn ${activeTab === 'matrix' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('matrix')}
        >
          <span>📊 智能体授权矩阵</span>
          <span className="settings-tab-cnt">{visibleAssistants.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'mcp'}
          className={`settings-tab-btn ${activeTab === 'mcp' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('mcp')}
        >
          <span>🔌 MCP 节点管理</span>
          <span className="settings-tab-cnt">{mcpServers.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'builtin'}
          className={`settings-tab-btn ${activeTab === 'builtin' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('builtin')}
        >
          <span>🛠️ 运行时内置工具</span>
          <span className="settings-tab-cnt">{builtinTools.length}</span>
        </button>

      </div>

      {/* 状态与通知条 */}
      {notice ? (
        <div
          role="status"
          style={{
            marginBottom: '12px',
            padding: '8px 14px',
            background: noticeFailed ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${noticeFailed ? '#fecaca' : '#bbf7d0'}`,
            borderRadius: '6px',
            color: noticeFailed ? '#b91c1c' : '#15803d',
            fontSize: '12.5px',
            fontWeight: 500,
          }}
        >
          {notice}
        </div>
      ) : null}

      {registryError && (
        <div
          role="alert"
          style={{
            marginBottom: '12px',
            padding: '8px 14px',
            background: '#fef2f2',
            color: '#b91c1c',
            borderRadius: '6px',
            fontSize: '12.5px',
          }}
        >
          MCP / 内置工具状态：{registryError}
          <button
            type="button"
            onClick={() => void loadRegistry()}
            style={{ marginLeft: '12px', color: '#165dff', border: 'none', background: 'none', cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      )}

      {assistantsError && (
        <div
          role="alert"
          style={{
            marginBottom: '12px',
            padding: '8px 14px',
            background: '#fef2f2',
            color: '#b91c1c',
            borderRadius: '6px',
            fontSize: '12.5px',
          }}
        >
          助手列表：{assistantsError}
          <button
            type="button"
            onClick={() => void loadAssistants()}
            style={{ marginLeft: '12px', color: '#165dff', border: 'none', background: 'none', cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      )}

      {loading ? (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '40px',
            textAlign: 'center',
            color: '#64748b',
            fontSize: '13px',
          }}
        >
          正在读取 AI 运行时快照与助手授权清单…
        </div>
      ) : (
        <>
          {/* ===================== TAB 1: 智能体授权矩阵 ===================== */}
          {activeTab === 'matrix' && (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
              {/* 高密度单行工具栏 (消除原本冗长空旷的大白卡片) */}
              <div
                style={{
                  padding: '10px 16px',
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                    <label style={{ fontWeight: 600, color: '#334155' }}>团队范围:</label>
                    <select
                      value={teamId}
                      disabled={matrixDisabled}
                      onChange={(e) => setTeamId(e.target.value)}
                      style={{
                        padding: '4px 10px',
                        height: '32px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '12.5px',
                        background: '#ffffff',
                      }}
                    >
                      <option value="">全部助手 ({assistants.length})</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <input
                    type="text"
                    placeholder="过滤助手..."
                    value={assistantSearch}
                    onChange={(e) => setAssistantSearch(e.target.value)}
                    style={{
                      height: '32px',
                      padding: '0 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12.5px',
                      width: '150px',
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => setShowHelpBanner(!showHelpBanner)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: '4px 6px',
                    }}
                  >
                    ℹ️ {showHelpBanner ? '收起说明' : '授权规则说明'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={matrixDisabled}
                    onClick={() => void runOperation(() => setEntireMatrix(true))}
                    className="settings-pill-btn"
                    style={{ background: '#165dff', color: '#fff', borderColor: '#165dff', fontWeight: 600, fontSize: '12px', padding: '4px 10px' }}
                  >
                    全部全选
                  </button>
                  <button
                    type="button"
                    disabled={matrixDisabled}
                    onClick={() => void runOperation(() => setEntireMatrix(false))}
                    className="settings-pill-btn"
                    style={{ fontSize: '12px', padding: '4px 10px' }}
                  >
                    全部取消
                  </button>
                  {matrixBusy && <span style={{ fontSize: '12px', color: '#165dff' }}>⚡ 保存中…</span>}
                </div>
              </div>

              {/* 可选展开的简要说明条 */}
              {showHelpBanner && (
                <div
                  style={{
                    padding: '8px 16px',
                    background: '#eff6ff',
                    borderBottom: '1px solid #dbeafe',
                    fontSize: '12px',
                    color: '#1e40af',
                    lineHeight: 1.5,
                  }}
                >
                  行表示助手（勾选即时回读生效）；列包含 MCP 外部节点与平台受控内置工具。撤销权限即时生效。已有项目继续使用确认时的教学安排。
                </div>
              )}

              {/* 紧凑授权矩阵表格 (锁定紧凑列宽，彻底杜绝空白拉伸) */}
              {visibleAssistants.length === 0 ? (
                <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  当前筛选条件下没有助手。
                </div>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
                  <table
                    style={{
                      width: 'max-content',
                      minWidth: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '12.5px',
                    }}
                  >
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0' }}>
                        {/* 第一列：助手名 (固定在左侧，保持紧凑) */}
                        <th
                          style={{
                            padding: '10px 14px',
                            fontWeight: 700,
                            color: '#1e293b',
                            width: '180px',
                            minWidth: '180px',
                            maxWidth: '220px',
                            position: 'sticky',
                            left: 0,
                            background: '#f8fafc',
                            zIndex: 2,
                            boxShadow: '2px 0 4px rgba(0,0,0,0.03)',
                          }}
                        >
                          智能体角色 ({visibleAssistants.length})
                        </th>

                        {/* MCP 列 */}
                        {mcpServers.map((server) => (
                          <th
                            key={server.id}
                            style={{
                              padding: '8px 10px',
                              width: '115px',
                              minWidth: '115px',
                              maxWidth: '130px',
                              textAlign: 'center',
                              borderLeft: '1px solid #f1f5f9',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                              <span
                                style={{
                                  fontSize: '10px',
                                  color: server.status === 'connected' ? '#16a34a' : '#dc2626',
                                }}
                              >
                                ●
                              </span>
                              <strong style={{ fontSize: '12px', color: '#0f172a' }}>{server.label}</strong>
                            </div>
                            <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>
                              MCP · {server.toolCount ?? 0} 工具
                            </div>
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginTop: '4px' }}>
                              <button
                                type="button"
                                disabled={matrixDisabled || !server.enabled || server.status !== 'connected'}
                                onClick={() => void runOperation(() => setMcpColumnForAll(server, true))}
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  border: '1px solid #bfdbfe',
                                  background: '#eff6ff',
                                  color: '#1d4ed8',
                                  cursor: 'pointer',
                                }}
                              >
                                全选
                              </button>
                              <button
                                type="button"
                                disabled={matrixDisabled}
                                onClick={() => void runOperation(() => setMcpColumnForAll(server, false))}
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  border: '1px solid #cbd5e1',
                                  background: '#ffffff',
                                  color: '#64748b',
                                  cursor: 'pointer',
                                }}
                              >
                                清空
                              </button>
                            </div>
                          </th>
                        ))}

                        {/* 内置工具列 */}
                        {builtinTools.map((tool) => (
                          <th
                            key={tool.id}
                            style={{
                              padding: '8px 10px',
                              width: '115px',
                              minWidth: '115px',
                              maxWidth: '130px',
                              textAlign: 'center',
                              borderLeft: '1px solid #f1f5f9',
                            }}
                          >
                            <div style={{ fontSize: '12px', color: '#4338ca', fontWeight: 600 }}>{tool.label}</div>
                            <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>
                              内置 · {RISK_TEXT[tool.riskLevel]}
                            </div>
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginTop: '4px' }}>
                              <button
                                type="button"
                                disabled={matrixDisabled}
                                onClick={() => void runOperation(() => setBuiltinColumnForAll(tool, true))}
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  border: '1px solid #ddd6fe',
                                  background: '#f5f3ff',
                                  color: '#6d28d9',
                                  cursor: 'pointer',
                                }}
                              >
                                全选
                              </button>
                              <button
                                type="button"
                                disabled={matrixDisabled}
                                onClick={() => void runOperation(() => setBuiltinColumnForAll(tool, false))}
                                style={{
                                  fontSize: '10px',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  border: '1px solid #cbd5e1',
                                  background: '#ffffff',
                                  color: '#64748b',
                                  cursor: 'pointer',
                                }}
                              >
                                清空
                              </button>
                            </div>
                          </th>
                        ))}

                        <th style={{ padding: '8px 12px', width: '90px', minWidth: '90px', textAlign: 'center' }}>
                          行快捷
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAssistants.map((assistant, idx) => (
                        <tr
                          key={assistant.id}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            background: idx % 2 === 0 ? '#ffffff' : '#fafbfe',
                          }}
                        >
                          {/* 助手名称（固定在左侧） */}
                          <td
                            style={{
                              padding: '8px 14px',
                              position: 'sticky',
                              left: 0,
                              background: idx % 2 === 0 ? '#ffffff' : '#fafbfe',
                              zIndex: 1,
                              boxShadow: '2px 0 4px rgba(0,0,0,0.03)',
                            }}
                          >
                            <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '13px' }}>
                              {assistant.name}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                              <span style={{ padding: '1px 5px', background: '#e2e8f0', borderRadius: '3px' }}>
                                {assistant.role || '智能导师'}
                              </span>
                            </div>
                          </td>

                          {/* MCP 单元格 */}
                          {mcpServers.map((server) => {
                            const isChecked = isMcpBound(assistant, server);
                            return (
                              <td
                                key={server.id}
                                onClick={() => {
                                  if (!matrixDisabled && (isChecked || (server.enabled && server.status === 'connected'))) {
                                    void runOperation(() => toggleMcpForAssistant(server, assistant));
                                  }
                                }}
                                style={{
                                  padding: '6px 8px',
                                  textAlign: 'center',
                                  borderLeft: '1px solid #f1f5f9',
                                  background: isChecked ? '#eff6ff' : 'transparent',
                                  cursor: matrixDisabled ? 'not-allowed' : 'pointer',
                                }}
                                title={
                                  isChecked
                                    ? `已授权 ${server.label}（点击取消）`
                                    : `未授权 ${server.label}（点击授权）`
                                }
                              >
                                <div
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '4px',
                                    border: `1.5px solid ${isChecked ? '#2563eb' : '#cbd5e1'}`,
                                    background: isChecked ? '#2563eb' : '#ffffff',
                                    color: '#ffffff',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                  }}
                                >
                                  {isChecked ? '✓' : ''}
                                </div>
                              </td>
                            );
                          })}

                          {/* 内置工具单元格 */}
                          {builtinTools.map((tool) => {
                            const isChecked = isBuiltinBound(assistant, tool);
                            return (
                              <td
                                key={tool.id}
                                onClick={() => {
                                  if (!matrixDisabled) {
                                    void runOperation(() => toggleBuiltinForAssistant(tool, assistant));
                                  }
                                }}
                                style={{
                                  padding: '6px 8px',
                                  textAlign: 'center',
                                  borderLeft: '1px solid #f1f5f9',
                                  background: isChecked ? '#f5f3ff' : 'transparent',
                                  cursor: matrixDisabled ? 'not-allowed' : 'pointer',
                                }}
                                title={
                                  isChecked
                                    ? `已授权【${tool.label}】（点击取消）`
                                    : `未授权【${tool.label}】（点击授权）`
                                }
                              >
                                <div
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '4px',
                                    border: `1.5px solid ${isChecked ? '#7c3aed' : '#cbd5e1'}`,
                                    background: isChecked ? '#7c3aed' : '#ffffff',
                                    color: '#ffffff',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                  }}
                                >
                                  {isChecked ? '✓' : ''}
                                </div>
                              </td>
                            );
                          })}

                          {/* 行快捷操作 */}
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                              <button
                                type="button"
                                disabled={matrixDisabled}
                                onClick={() => void runOperation(() => setAssistantRow(assistant, true))}
                                style={{
                                  fontSize: '10.5px',
                                  padding: '2px 5px',
                                  borderRadius: '3px',
                                  border: '1px solid #bfdbfe',
                                  background: '#eff6ff',
                                  color: '#1d4ed8',
                                  cursor: 'pointer',
                                }}
                                title="开启当前可见全部"
                              >
                                全选
                              </button>
                              <button
                                type="button"
                                disabled={matrixDisabled}
                                onClick={() => void runOperation(() => setAssistantRow(assistant, false))}
                                style={{
                                  fontSize: '10.5px',
                                  padding: '2px 5px',
                                  borderRadius: '3px',
                                  border: '1px solid #cbd5e1',
                                  background: '#ffffff',
                                  color: '#64748b',
                                  cursor: 'pointer',
                                }}
                                title="清空该助手"
                              >
                                清空
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ===================== TAB 2: MCP 节点管理（含 JSON 编辑与工具透视） ===================== */}
          {activeTab === 'mcp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {unresolvedTools.length > 0 && (
                <ToolBindingMigrationPanel onMigrated={onToolBindingsMigrated} />
              )}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                <KnowledgeConfiguration onMode={() => setActiveTab('matrix')} />
              </div>
            </div>
          )}

          {/* ===================== TAB 3: 运行时内置工具（含参数层级展开） ===================== */}
          {activeTab === 'builtin' && (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <strong style={{ fontSize: '15px', color: '#0f172a' }}>运行时受控内置工具 ({builtinTools.length})</strong>
                  <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                    由平台运行时内核加载与门禁拦截，按安全风险评级与 TheoryMastered 门槛受控调用。点击任意工具行可层级展开详细输入参数结构。
                  </p>
                </div>
                <button
                  type="button"
                  style={{
                    padding: '5px 12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    background: '#f8fafc',
                    fontSize: '12px',
                    color: '#2563eb',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  onClick={() => {
                    const allIds = builtinTools.map(t => t.id);
                    setExpandedBuiltinTools(prev => prev.size === allIds.length ? new Set() : new Set(allIds));
                  }}
                >
                  {expandedBuiltinTools.size === builtinTools.length ? '▲ 折叠全部参数层级' : '▼ 展开全部参数层级'}
                </button>
              </div>

              {builtinTools.length === 0 ? (
                <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  未上报任何内置工具。
                </div>
              ) : (
                <div className="admin-data-table admin-table-compact">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '44px', textAlign: 'center' }}>展开</th>
                        <th>工具名称</th>
                        <th>标识 ID</th>
                        <th>调用模式</th>
                        <th>状态</th>
                        <th>安全风险评级</th>
                        <th>门禁门槛</th>
                        <th>已授权助手数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {builtinTools.map((tool) => {
                        const boundCount = assistants.filter((a) => a.toolIds.includes(tool.id)).length;
                        const isExpanded = expandedBuiltinTools.has(tool.id);
                        const schema = BUILTIN_TOOL_SCHEMAS[tool.id];
                        return (
                          <Fragment key={tool.id}>
                            <tr
                              style={{ cursor: 'pointer', background: isExpanded ? '#f8fafc' : undefined }}
                              onClick={() => {
                                setExpandedBuiltinTools(prev => {
                                  const next = new Set(prev);
                                  if (next.has(tool.id)) next.delete(tool.id);
                                  else next.add(tool.id);
                                  return next;
                                });
                              }}
                            >
                              <td style={{ textAlign: 'center' }}>
                                <span style={{ color: '#64748b', fontSize: '11px', display: 'inline-block' }}>
                                  {isExpanded ? '▼' : '▶'}
                                </span>
                              </td>
                              <td>
                                <strong style={{ color: '#0f172a' }}>{tool.label}</strong>
                                {tool.description && (
                                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                    {tool.description}
                                  </div>
                                )}
                              </td>
                              <td>
                                <code>{tool.id}</code>
                              </td>
                              <td>
                                <span style={{ fontSize: '12px', color: '#475569' }}>
                                  {tool.invocation === 'domain_service'
                                    ? '领域服务执行'
                                    : tool.invocation === 'sdk_read'
                                    ? 'SDK 只读接口'
                                    : '模型自主工具'}
                                </span>
                              </td>
                              <td>
                                <span
                                  style={{
                                    fontSize: '11.5px',
                                    color: tool.status === 'ready' || tool.status === 'enabled' ? '#15803d' : '#b91c1c',
                                    fontWeight: 600,
                                  }}
                                >
                                  ● {BUILTIN_STATUS_TEXT[tool.status]}
                                </span>
                              </td>
                              <td>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                    background: tool.riskLevel === 'high' ? '#fef2f2' : tool.riskLevel === 'medium' ? '#fffbeb' : '#f1f5f9',
                                    color: tool.riskLevel === 'high' ? '#b91c1c' : tool.riskLevel === 'medium' ? '#b45309' : '#475569',
                                  }}
                                >
                                  {RISK_TEXT[tool.riskLevel]}
                                </span>
                              </td>
                              <td>
                                {tool.requiresTheoryMastered ? (
                                  <span
                                    style={{
                                      fontSize: '11px',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      background: '#fff7ed',
                                      color: '#c2410c',
                                      fontWeight: 600,
                                    }}
                                  >
                                    需 TheoryMastered
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>无门禁</span>
                                )}
                              </td>
                              <td>
                                <span
                                  style={{
                                    background: boundCount > 0 ? '#f5f3ff' : '#f1f5f9',
                                    color: boundCount > 0 ? '#6d28d9' : '#64748b',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                  }}
                                >
                                  {boundCount} 位助手
                                </span>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={8} style={{ padding: '0 16px 14px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                                  <HierarchicalSchemaViewer
                                    schema={schema}
                                    title={'工具 [' + tool.label + '] 的输入参数层级规约与校验规则'}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
