'use client';

import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import { persistAssistantBinding, BUILTIN_IMAGE_GENERATION_ID, BUILTIN_SANDBOX_ID } from '../../../../lib/api/assistantBindings';
import type { AdminAssistantConfig, AdminImaSettings, AdminImaSettingsPatch } from '@qitu/contracts';
import { fetchImaSettings, saveImaSettings, checkImaConnection } from '../../../../lib/api/ima';
import { createIdempotentRetryKey } from '../../../../lib/api/types';

const IMA_ID = 'ima-knowledge';

function imaConfig(settings: AdminImaSettings | null) {
  return {
    name: 'ima知识库', transport: 'streamable_http', enabled: settings?.enabled ?? false,
    description: '共享教材知识库，只读检索与原文阅读；连接凭证由服务器管理。',
    tools: settings?.tools ?? [],
    boundAssistants: settings?.assistants.filter((row) => row.authorized).map((row) => row.id) ?? [],
  };
}

/** The existing editor shape is retained; only ima's writable fields reach its admin API. */
function imaPatch(value: unknown, settings: AdminImaSettings): AdminImaSettingsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ima 配置须为对象');
  const input = value as Record<string, unknown>;
  const current = imaConfig(settings);
  if (Object.keys(input).some((key) => !Object.keys(current).includes(key))) throw new Error('ima 仅允许编辑 enabled 和 boundAssistants，连接凭证由服务器管理');
  for (const field of ['name', 'transport', 'description', 'tools'] as const) {
    if (field in input && JSON.stringify(input[field]) !== JSON.stringify(current[field])) throw new Error(`ima 的 ${field} 由服务器管理`);
  }
  if (typeof input.enabled !== 'boolean' || !Array.isArray(input.boundAssistants)
    || input.boundAssistants.some((id) => typeof id !== 'string') || new Set(input.boundAssistants).size !== input.boundAssistants.length) {
    throw new Error('ima 配置须包含布尔 enabled 和唯一助手 ID 列表 boundAssistants');
  }
  const ids = input.boundAssistants as string[];
  if (ids.some((id) => !settings.assistants.some((row) => row.id === id))) throw new Error('ima 授权中包含未知助手 ID');
  return { enabled: input.enabled, assistantBindings: settings.assistants.map((row) => ({ id: row.id, enabled: ids.includes(row.id) })) };
}

export interface SingleMcpConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  transport?: 'stdio' | 'sse' | 'streamable_http';
  status: 'connected' | 'disconnected' | 'error';
  latencyMs?: number;
  tools: string[];
  boundAssistants: string[];
  description?: string;
  rawJson: string;
}

const DEFAULT_MCP_LIST: SingleMcpConfig[] = [
  {
    id: 'mcp-grok-search',
    name: 'groksearch',
    command: 'uvx',
    args: ['--from', 'git+https://github.com/GuDaStudio/GrokSearch@grok-with-tavily', 'groksearch'],
    env: {
      GROK_API_KEY: 'xai-grok-search-live-key',
      TAVILY_API_KEY: 'tvly-free-search-key',
    },
    transport: 'stdio',
    status: 'connected',
    latencyMs: 26,
    tools: ['grok_web_search', 'fetch_page_markdown', 'knowledge_crawl', 'citation_extract'],
    boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
    description: '集成自 Pi/Codex 的 Grok 深度搜索与 Tavily 互联网实时检索，支持学术与事实溯源。',
    rawJson: JSON.stringify(
      {
        name: 'groksearch',
        command: 'uvx',
        args: ['--from', 'git+https://github.com/GuDaStudio/GrokSearch@grok-with-tavily', 'groksearch'],
        env: {
          GROK_API_KEY: 'xai-grok-search-live-key',
          TAVILY_API_KEY: 'tvly-free-search-key',
        },
        transport: 'stdio',
        description: '集成自 Pi/Codex 的 Grok 深度搜索与 Tavily 互联网实时检索，支持学术与事实溯源。',
        boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
        tools: ['grok_web_search', 'fetch_page_markdown', 'knowledge_crawl', 'citation_extract'],
      },
      null,
      2
    ),
  },
  {
    id: 'mcp-chrome-devtools',
    name: 'chrome-devtools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-chrome-devtools'],
    transport: 'stdio',
    status: 'connected',
    latencyMs: 18,
    tools: ['launch_browser', 'navigate_page', 'click_element', 'take_screenshot', 'capture_console'],
    boundAssistants: ['雷霆战机总导师', '代码向导与答辩导师'],
    description: 'Chrome DevTools 自动化视口控制、页面渲染监测与前端控制台日志捕获。',
    rawJson: JSON.stringify(
      {
        name: 'chrome-devtools',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-chrome-devtools'],
        transport: 'stdio',
        description: 'Chrome DevTools 自动化视口控制、页面渲染监测与前端控制台日志捕获。',
        boundAssistants: ['雷霆战机总导师', '代码向导与答辩导师'],
        tools: ['launch_browser', 'navigate_page', 'click_element', 'take_screenshot', 'capture_console'],
      },
      null,
      2
    ),
  },
  {
    id: 'mcp-aionui-browser',
    name: 'aionui-browser',
    command: 'npx',
    args: ['-y', '@aionui/browser-mcp'],
    transport: 'stdio',
    status: 'connected',
    latencyMs: 22,
    tools: ['browser_tab_open', 'read_dom', 'execute_js_action', 'snapshot_viewport'],
    boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
    description: 'AionUI 浏览器自动化 DOM 读取与学生交互沙箱。',
    rawJson: JSON.stringify(
      {
        name: 'aionui-browser',
        command: 'npx',
        args: ['-y', '@aionui/browser-mcp'],
        transport: 'stdio',
        description: 'AionUI 浏览器自动化 DOM 读取与学生交互沙箱。',
        boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
        tools: ['browser_tab_open', 'read_dom', 'execute_js_action', 'snapshot_viewport'],
      },
      null,
      2
    ),
  },
  {
    id: 'mcp-fetch',
    name: 'fetch',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    transport: 'stdio',
    status: 'connected',
    latencyMs: 15,
    tools: ['fetch_html', 'fetch_markdown', 'extract_links'],
    boundAssistants: ['动手学动能定理总导师', '雷霆战机总导师'],
    description: '官方轻量免费网页抓取与 Markdown 内容抽取 MCP 服务器。',
    rawJson: JSON.stringify(
      {
        name: 'fetch',
        command: 'uvx',
        args: ['mcp-server-fetch'],
        transport: 'stdio',
        description: '官方轻量免费网页抓取与 Markdown 内容抽取 MCP 服务器。',
        boundAssistants: ['动手学动能定理总导师', '雷霆战机总导师'],
        tools: ['fetch_html', 'fetch_markdown', 'extract_links'],
      },
      null,
      2
    ),
  },
];

// 将 MCP 列表序列化为全局标准 mcpServers JSON 格式
function listToGlobalMcpJson(list: SingleMcpConfig[]): string {
  const mcpServers: Record<string, unknown> = {};
  for (const item of list) {
    if (item.id === IMA_ID) { mcpServers[item.name] = JSON.parse(item.rawJson); continue; }
    try {
      const parsed = JSON.parse(item.rawJson);
      mcpServers[item.name] = {
        command: parsed.command || item.command,
        args: parsed.args || item.args,
        env: parsed.env || item.env,
        description: parsed.description || item.description,
        tools: parsed.tools || item.tools,
        boundAssistants: parsed.boundAssistants || item.boundAssistants,
      };
    } catch {
      mcpServers[item.name] = {
        command: item.command,
        args: item.args,
        env: item.env,
        description: item.description,
        tools: item.tools,
        boundAssistants: item.boundAssistants,
      };
    }
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

export default function ToolsSettingsPage() {
  const [storedMcpList, setStoredMcpList] = useState<SingleMcpConfig[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.admin.mcp_list');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed.filter((item) => item.id !== IMA_ID);
        }
      } catch {
        // fallback
      }
    }
    return DEFAULT_MCP_LIST;
  });
  const [ima, setIma] = useState<AdminImaSettings | null>(null);
  const [imaError, setImaError] = useState('');
  const [imaPending, setImaPending] = useState(false);
  const imaBusy = useRef(false);
  const imaRetry = useRef(createIdempotentRetryKey());
  const imaCheckRetry = useRef(createIdempotentRetryKey());
  const imaRow = useMemo<SingleMcpConfig>(() => ({
    id: IMA_ID, name: 'ima知识库', command: '', args: [], transport: 'streamable_http',
    status: ima?.status === 'connected' ? 'connected' : ima?.status === 'error' ? 'error' : 'disconnected',
    tools: [...(ima?.tools ?? [])],
    boundAssistants: ima?.assistants.filter((row) => row.authorized).map((row) => row.name) ?? [],
    description: imaConfig(ima).description, rawJson: JSON.stringify(imaConfig(ima), null, 2),
  }), [ima]);
  const mcpList = useMemo(() => [...storedMcpList, imaRow], [storedMcpList, imaRow]);
  // Keep all original MCP drafts and controls intact; ima is never a local draft.
  const setMcpList = (action: SetStateAction<SingleMcpConfig[]>) => setStoredMcpList((previous) =>
    (typeof action === 'function' ? action(previous) : action).filter((row) => row.id !== IMA_ID));

  // 当前选中的设置目标：'global'（总的 mcpServers 设置）或 单个 MCP 的 id
  const [selectedTarget, setSelectedTarget] = useState<string>('global');

  // 当前主工作台模式：'matrix' (启用与关闭矩阵) | 'edit' (JSON 编辑) | 'preview' (实时预览)
  const [activeMode, setActiveMode] = useState<'matrix' | 'edit' | 'preview'>('matrix');

  // JSON 草稿与错误提示
  const [jsonTextDraft, setJsonTextDraft] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);

  const acceptIma = (settings: AdminImaSettings) => {
    setIma(settings);
    setAssistants((previous) => previous.map((assistant) => {
      const authorized = settings.assistants.find((row) => row.id === assistant.id)?.authorized;
      if (authorized === undefined) return assistant;
      return { ...assistant, mcpServerIds: authorized
        ? [...new Set([...assistant.mcpServerIds, IMA_ID])]
        : assistant.mcpServerIds.filter((id) => id !== IMA_ID) };
    }));
  };

  const loadIma = async () => {
    if (imaBusy.current) return;
    imaBusy.current = true; setImaPending(true); setImaError('');
    try { acceptIma(await fetchImaSettings()); }
    catch (error) { setIma(null); setImaError(error instanceof Error ? error.message : 'ima 配置读取失败'); }
    finally { imaBusy.current = false; setImaPending(false); }
  };
  useEffect(() => { void loadIma(); }, []);

  const saveIma = async (patch: AdminImaSettingsPatch): Promise<boolean> => {
    if (imaBusy.current || !ima?.registered) return false;
    imaBusy.current = true; setImaPending(true); setImaError('');
    try {
      acceptIma(await saveImaSettings(patch, imaRetry.current.keyFor(JSON.stringify(patch))));
      imaRetry.current.acknowledge(); setNotice('ima 知识库设置已保存到服务器'); return true;
    } catch (error) { setImaError(error instanceof Error ? error.message : 'ima 保存失败'); return false; }
    finally { imaBusy.current = false; setImaPending(false); }
  };

  const toggleImaAssistant = async (identifier: string) => {
    const assistant = ima?.assistants.find((row) => row.id === identifier || row.name === identifier);
    if (assistant) await saveIma({ assistantBindings: [{ id: assistant.id, enabled: !assistant.authorized }] });
  };

  const checkIma = async () => {
    if (imaBusy.current || !ima?.registered) return;
    imaBusy.current = true; setImaPending(true); setImaError('');
    try {
      const result = await checkImaConnection(imaCheckRetry.current.keyFor('check'));
      acceptIma(result); imaCheckRetry.current.acknowledge();
      setNotice(result.status === 'connected' ? 'ima 连接检查通过，知识库读取正常' : 'ima 连接检查失败');
    } catch (error) { setImaError(error instanceof Error ? error.message : 'ima 连接检查失败'); }
    finally { imaBusy.current = false; setImaPending(false); }
  };

  // 内置工具绑定的助手列表（支持 localStorage 读写）
  const [imageGenAssistants, setImageGenAssistants] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.admin.imagegen_assistants');
        if (cached) return JSON.parse(cached);
      } catch {}
    }
    return ['雷霆战机总导师', '代码向导与答辩导师', '战机架构与代码向导'];
  });
  const [sandboxAssistants, setSandboxAssistants] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.admin.sandbox_assistants');
        if (cached) return JSON.parse(cached);
      } catch {}
    }
    return ['雷霆战机总导师', '动手学动能定理总导师', '代码向导与答辩导师', '战机架构与代码向导', '动能定理仿真与实验向导'];
  });

  // 内置工具全局总开关状态
  const [imageGenEnabled, setImageGenEnabled] = useState<boolean>(true);
  const [sandboxEnabled, setSandboxEnabled] = useState<boolean>(true);

  // 挂载时加载助手信息
  useEffect(() => {
    fetchAdminAssistantConfigs()
      .then((res) => {
        if (res && res.length > 0) setAssistants(res);
      })
      .catch(() => {});
  }, []);

  // 持久化存储内置工具绑定
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qitu.admin.imagegen_assistants', JSON.stringify(imageGenAssistants));
        localStorage.setItem('qitu.admin.sandbox_assistants', JSON.stringify(sandboxAssistants));
      } catch {}
    }
  }, [imageGenAssistants, sandboxAssistants]);

  // 当前可用的助手角色列表（优先使用后台真实数据，保底提供默认战队导师）
  const activeAssistantsList = useMemo(() => {
    if (assistants.length > 0) {
      return assistants.map((a) => ({ id: a.id, name: a.name, role: a.role }));
    }
    return [
      { id: 'qitu-assistant', name: '启途智学管家', role: '平台管家' },
      { id: 'asst-thunder', name: '雷霆战机总导师', role: 'Leader' },
      { id: 'asst-kinetic', name: '动手学动能定理总导师', role: 'Leader' },
      { id: 'asst-coder', name: '代码向导与答辩导师', role: 'Teammate' },
      { id: 'asst-coach', name: '原理教练', role: 'Coach' },
      { id: 'asst-reviewer', name: '评审导师', role: 'Reviewer' },
    ];
  }, [assistants]);

  // 持久化存储 MCP 列表
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qitu.admin.mcp_list', JSON.stringify(storedMcpList));
      } catch {
        // guard
      }
    }
  }, [storedMcpList]);

  // 当前选中的单独 MCP（如果是 global 则为 null）
  const currentSingleMcp = useMemo(() => {
    if (selectedTarget === 'global') return null;
    return mcpList.find((m) => m.id === selectedTarget) ?? null;
  }, [mcpList, selectedTarget]);

  // 当切换选中目标时，重置并同步草稿文本
  useEffect(() => {
    if (selectedTarget === 'global') {
      setJsonTextDraft(listToGlobalMcpJson(mcpList));
    } else {
      const single = mcpList.find((m) => m.id === selectedTarget);
      if (single) {
        setJsonTextDraft(single.rawJson);
      }
    }
    setJsonError(null);
  }, [selectedTarget, mcpList.length, ima]);

  // 格式化当前正在编辑的 JSON
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonTextDraft);
      setJsonTextDraft(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (err) {
      setJsonError('格式化失败: ' + (err as Error).message);
    }
  };

  // 保存当前 JSON 配置（支持保存全局或单独 MCP）
  const handleSaveJson = async () => {
    try {
      const parsed = JSON.parse(jsonTextDraft);

      if (selectedTarget === IMA_ID) {
        if (!ima?.registered) throw new Error('请先读取 ima 服务器配置');
        if (await saveIma(imaPatch(parsed, ima))) setJsonError(null);
        return;
      }

      if (selectedTarget === 'global') {
        // 保存全局配置，解析 mcpServers 并同步更新列表
        const record = parsed.mcpServers || parsed;
        if (!ima?.registered || !record['ima知识库']) throw new Error('全局配置须保留 ima知识库 项；如需停用，请将 enabled 设为 false');
        const managedPatch = imaPatch(record['ima知识库'], ima);
        const nextList: SingleMcpConfig[] = [];
        for (const [key, val] of Object.entries(record)) {
          if (key === 'ima知识库') continue;
          if (typeof val !== 'object' || val === null) continue;
          const v = val as Record<string, unknown>;
          const existing = mcpList.find((m) => m.name === key);
          const singleObj = {
            name: key,
            command: typeof v.command === 'string' ? v.command : 'npx',
            args: Array.isArray(v.args) ? v.args.map(String) : [],
            env: typeof v.env === 'object' && v.env !== null ? (v.env as Record<string, string>) : undefined,
            description: typeof v.description === 'string' ? v.description : existing?.description,
            tools: Array.isArray(v.tools) ? v.tools.map(String) : existing?.tools || ['tool_call'],
            boundAssistants: Array.isArray(v.boundAssistants) ? v.boundAssistants.map(String) : existing?.boundAssistants || ['雷霆战机总导师'],
          };
          nextList.push({
            id: existing ? existing.id : `mcp-${key.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`,
            name: key,
            command: singleObj.command,
            args: singleObj.args,
            env: singleObj.env,
            transport: 'stdio',
            status: 'connected',
            latencyMs: existing?.latencyMs ?? 20,
            tools: singleObj.tools,
            boundAssistants: singleObj.boundAssistants,
            description: singleObj.description,
            rawJson: JSON.stringify(singleObj, null, 2),
          });
        }
        if (!await saveIma(managedPatch)) return;
        setMcpList(nextList);
        setNotice('全局 MCP 配置（mcpServers）已成功校验并生效！✔');
      } else if (currentSingleMcp) {
        // 保存单个 MCP 的 JSON 配置
        const name = parsed.name || currentSingleMcp.name;
        const command = parsed.command || 'npx';
        const args = Array.isArray(parsed.args) ? parsed.args.map(String) : [];
        const env = typeof parsed.env === 'object' && parsed.env !== null ? parsed.env : undefined;
        const tools = Array.isArray(parsed.tools) ? parsed.tools.map(String) : currentSingleMcp.tools;
        const boundAssistants = Array.isArray(parsed.boundAssistants) ? parsed.boundAssistants.map(String) : currentSingleMcp.boundAssistants;
        const description = typeof parsed.description === 'string' ? parsed.description : currentSingleMcp.description;

        const updatedMcp: SingleMcpConfig = {
          ...currentSingleMcp,
          name,
          command,
          args,
          env,
          tools,
          boundAssistants,
          description,
          rawJson: JSON.stringify(parsed, null, 2),
        };

        setMcpList((prev) => prev.map((m) => (m.id === currentSingleMcp.id ? updatedMcp : m)));
        setNotice(`独立 MCP【${name}】的独立 JSON 配置已更新并保存！✔`);
      }

      setJsonError(null);
      setTimeout(() => setNotice(''), 2500);
    } catch (err) {
      setJsonError('JSON 语法错误: ' + (err as Error).message);
    }
  };

  // 添加新 MCP
  const handleAddNewMcp = () => {
    const rawName = prompt('请输入新 MCP 名称 (例如 filesystem, sqlite, github)：');
    if (!rawName || !rawName.trim()) return;
    const name = rawName.trim().toLowerCase();
    if (name === 'ima知识库' || name === IMA_ID) { setImaError('ima 知识库已由服务器管理，请选择现有 ima 行'); return; }
    const newId = `mcp-${name}-${Date.now().toString().slice(-4)}`;
    const templateObj = {
      name,
      command: 'npx',
      args: [`-y`, `@modelcontextprotocol/server-${name}`],
      env: {},
      transport: 'stdio',
      description: `自定义 ${name} MCP 独立服务器配置`,
      boundAssistants: ['雷霆战机总导师'],
      tools: [`${name}_action`, `${name}_query`],
    };
    const newMcp: SingleMcpConfig = {
      id: newId,
      name,
      command: 'npx',
      args: [`-y`, `@modelcontextprotocol/server-${name}`],
      transport: 'stdio',
      status: 'connected',
      latencyMs: 20,
      tools: templateObj.tools,
      boundAssistants: templateObj.boundAssistants,
      description: templateObj.description,
      rawJson: JSON.stringify(templateObj, null, 2),
    };

    setMcpList((prev) => [...prev, newMcp]);
    setSelectedTarget(newId);
    setNotice(`已新建 MCP【${name}】并进入独立配置！✔`);
    setTimeout(() => setNotice(''), 2500);
  };

  // 删除当前选中的单独 MCP
  const handleDeleteCurrentMcp = (id: string, name: string) => {
    if (id === IMA_ID) { void saveIma({ enabled: false }); return; }
    if (mcpList.length <= 1) {
      alert('至少保留一个 MCP 工具服务器！');
      return;
    }
    if (!window.confirm(`确定要删除 MCP【${name}】配置吗？此操作不可逆。`)) return;
    const next = mcpList.filter((m) => m.id !== id);
    setMcpList(next);
    setSelectedTarget('global');
    setNotice(`MCP【${name}】已成功移除！✔`);
    setTimeout(() => setNotice(''), 2500);
  };

  // 绑定 / 解绑助手
  const toggleAssistantBinding = (asstName: string) => {
    if (!currentSingleMcp) return;
    if (currentSingleMcp.id === IMA_ID) { void toggleImaAssistant(asstName); return; }
    try {
      const parsed = JSON.parse(jsonTextDraft);
      let list: string[] = Array.isArray(parsed.boundAssistants) ? parsed.boundAssistants : [];
      if (list.includes(asstName)) {
        list = list.filter((n) => n !== asstName);
      } else {
        list.push(asstName);
      }
      parsed.boundAssistants = list;
      const formatted = JSON.stringify(parsed, null, 2);
      setJsonTextDraft(formatted);

      setMcpList((prev) =>
        prev.map((m) =>
          m.id === currentSingleMcp.id
            ? { ...m, boundAssistants: list, rawJson: formatted }
            : m
        )
      );
    } catch {
      // json error guard
    }
  };

  // 切换 MCP 对指定助手的授权 (打上✔ 立即生效)
  const toggleMcpForAssistant = async (mcpName: string, asstName: string) => {
    if (mcpName === 'ima知识库' || mcpName === IMA_ID) { await toggleImaAssistant(asstName); return; }
    const matchedAsst = assistants.find((a) => a.id === asstName || a.name === asstName);
    const targetAsstId = matchedAsst?.id || asstName;
    const targetAsstName = matchedAsst?.name || asstName;
    const asstIdentifiers = new Set([targetAsstId, targetAsstName, asstName].filter(Boolean));

    let nextChecked = false;
    const nextMcpList = mcpList.map((m) => {
      if (m.name !== mcpName && m.id !== mcpName) return m;
      const currentBound = Array.isArray(m.boundAssistants) ? [...m.boundAssistants] : [];
      const hasBound = currentBound.some((id) => asstIdentifiers.has(id));
      nextChecked = !hasBound;
      const nextBound = hasBound
        ? currentBound.filter((n) => !asstIdentifiers.has(n))
        : Array.from(new Set([...currentBound, targetAsstName, targetAsstId]));

      let updatedRawJson = m.rawJson;
      try {
        const parsed = JSON.parse(m.rawJson);
        parsed.boundAssistants = nextBound;
        updatedRawJson = JSON.stringify(parsed, null, 2);
      } catch {
        // fallback
      }

      return {
        ...m,
        boundAssistants: nextBound,
        rawJson: updatedRawJson,
      };
    });
    setMcpList(nextMcpList);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qitu.admin.mcp_list', JSON.stringify(nextMcpList.filter((row) => row.id !== IMA_ID)));
      } catch {}
    }

    if (matchedAsst) {
      const curServers: string[] = matchedAsst.mcpServerIds ? [...matchedAsst.mcpServerIds] : [];
      const updatedServers: string[] = nextChecked
        ? (curServers.includes(mcpName) ? curServers : [...curServers, mcpName])
        : curServers.filter((n) => n !== mcpName && n !== targetAsstId);

      setAssistants((prev) =>
        prev.map((a) => (a.id === matchedAsst.id ? { ...a, mcpServerIds: updatedServers } : a))
      );
      try {
        await persistAssistantBinding(matchedAsst.id, 'mcpServerIds', updatedServers);
      } catch {
        // fallback
      }
    }

    setNotice(`已更新【${targetAsstName}】对 MCP【${mcpName}】的授权 (${nextChecked ? '打上✔ 立即生效' : '取消✔ 立即关闭'})`);
    setTimeout(() => setNotice(''), 2500);
  };

  // 切换内置工具对指定助手的授权 (打上✔ 立即生效)
  const toggleBuiltinToolForAssistant = async (tool: 'imageGen' | 'sandbox', asstName: string) => {
    const builtinId = tool === 'imageGen' ? BUILTIN_IMAGE_GENERATION_ID : BUILTIN_SANDBOX_ID;
    const toolLabel = tool === 'imageGen' ? '图像生成' : 'Python 沙箱';
    const matchedAsst = assistants.find((a) => a.id === asstName || a.name === asstName);
    const targetAsstId = matchedAsst?.id || asstName;
    const targetAsstName = matchedAsst?.name || asstName;
    const asstIdentifiers = new Set([targetAsstId, targetAsstName, asstName].filter(Boolean));
    let nextChecked = false;

    if (tool === 'imageGen') {
      setImageGenAssistants((prev) => {
        const has = prev.some((id) => asstIdentifiers.has(id));
        nextChecked = !has;
        return has
          ? prev.filter((n) => !asstIdentifiers.has(n))
          : Array.from(new Set([...prev, targetAsstName, targetAsstId]));
      });
    } else {
      setSandboxAssistants((prev) => {
        const has = prev.some((id) => asstIdentifiers.has(id));
        nextChecked = !has;
        return has
          ? prev.filter((n) => !asstIdentifiers.has(n))
          : Array.from(new Set([...prev, targetAsstName, targetAsstId]));
      });
    }

    if (matchedAsst) {
      const curTools: string[] = matchedAsst.toolIds ? [...matchedAsst.toolIds] : [];
      const updatedTools: string[] = nextChecked
        ? (curTools.includes(builtinId) ? curTools : [...curTools, builtinId])
        : curTools.filter((t) => t !== builtinId);

      setAssistants((prev) =>
        prev.map((a) => (a.id === matchedAsst.id ? { ...a, toolIds: updatedTools } : a))
      );
      try {
        await persistAssistantBinding(matchedAsst.id, 'toolIds', updatedTools);
      } catch {}
    }

    setNotice(`已更新【${targetAsstName}】对【${toolLabel}】的权限 (${nextChecked ? '打上✔ 立即生效' : '取消✔ 立即关闭'})`);
    setTimeout(() => setNotice(''), 2500);
  };

  // 一键为某助手全选所有工具
  const grantAllToolsForAssistant = async (asstName: string) => {
    const imaAssistant = ima?.assistants.find((row) => row.id === asstName || row.name === asstName);
    if (imaAssistant && !await saveIma({ assistantBindings: [{ id: imaAssistant.id, enabled: true }] })) return;
    const nextMcp = mcpList.map((m) => {
      const currentBound = Array.isArray(m.boundAssistants) ? [...m.boundAssistants] : [];
      if (!currentBound.includes(asstName)) {
        currentBound.push(asstName);
      }
      let updatedRawJson = m.rawJson;
      try {
        const parsed = JSON.parse(m.rawJson);
        parsed.boundAssistants = currentBound;
        updatedRawJson = JSON.stringify(parsed, null, 2);
      } catch {}
      return { ...m, boundAssistants: currentBound, rawJson: updatedRawJson };
    });
    setMcpList(nextMcp);
    if (!imageGenAssistants.includes(asstName)) setImageGenAssistants((prev) => [...prev, asstName]);
    if (!sandboxAssistants.includes(asstName)) setSandboxAssistants((prev) => [...prev, asstName]);

    const matchedAsst = assistants.find((a) => a.id === asstName || a.name === asstName);
    if (matchedAsst) {
      try {
        await persistAssistantBinding(matchedAsst.id, 'toolIds', [BUILTIN_IMAGE_GENERATION_ID, BUILTIN_SANDBOX_ID]);
        await persistAssistantBinding(matchedAsst.id, 'mcpServerIds', nextMcp.map((m) => m.id === IMA_ID ? IMA_ID : m.name));
      } catch {}
    }
    setNotice(`已为【${matchedAsst?.name || asstName}】授予全部 MCP 与内置工具权限 (打上✔ 立即生效)`);
    setTimeout(() => setNotice(''), 2500);
  };

  // 一键清除某助手的所有工具授权
  const revokeAllToolsForAssistant = async (asstName: string) => {
    const imaAssistant = ima?.assistants.find((row) => row.id === asstName || row.name === asstName);
    if (imaAssistant && !await saveIma({ assistantBindings: [{ id: imaAssistant.id, enabled: false }] })) return;
    const nextMcp = mcpList.map((m) => {
      const nextBound = (m.boundAssistants || []).filter((n) => n !== asstName);
      let updatedRawJson = m.rawJson;
      try {
        const parsed = JSON.parse(m.rawJson);
        parsed.boundAssistants = nextBound;
        updatedRawJson = JSON.stringify(parsed, null, 2);
      } catch {}
      return { ...m, boundAssistants: nextBound, rawJson: updatedRawJson };
    });
    setMcpList(nextMcp);
    setImageGenAssistants((prev) => prev.filter((n) => n !== asstName));
    setSandboxAssistants((prev) => prev.filter((n) => n !== asstName));

    const matchedAsst = assistants.find((a) => a.id === asstName || a.name === asstName);
    if (matchedAsst) {
      try {
        await persistAssistantBinding(matchedAsst.id, 'toolIds', []);
        await persistAssistantBinding(matchedAsst.id, 'mcpServerIds', []);
      } catch {}
    }
    setNotice(`已清除【${matchedAsst?.name || asstName}】的所有工具授权 (立即生效)`);
    setTimeout(() => setNotice(''), 2500);
  };

  return (
    <div className="admin-tools-page-view" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '32px' }}>
      {/* 页头 */}
      <div className="admin-tools-header" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 className="admin-tools-title" style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
              工具与 MCP 配置中心
            </h1>
            <p className="admin-tools-subtitle" style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
              支持智能体授权矩阵、总的 mcpServers 全局配置与任意单个 MCP 的独立 JSON 设置。编辑与预览自由切换。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* 顶层切换按钮：矩阵 / 编辑 JSON / 实时预览 */}
            <div style={{ background: '#f1f5f9', padding: '3px', borderRadius: '8px', display: 'flex', border: '1px solid #e2e8f0', gap: '2px' }}>
              <button
                type="button"
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  borderRadius: '6px',
                  background: activeMode === 'matrix' ? '#ffffff' : 'transparent',
                  fontWeight: activeMode === 'matrix' ? 600 : 400,
                  boxShadow: activeMode === 'matrix' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: activeMode === 'matrix' ? '#165dff' : '#64748b',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                onClick={() => setActiveMode('matrix')}
              >
                📊 智能体授权矩阵
              </button>
              <button
                type="button"
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  borderRadius: '6px',
                  background: activeMode === 'edit' ? '#ffffff' : 'transparent',
                  fontWeight: activeMode === 'edit' ? 600 : 400,
                  boxShadow: activeMode === 'edit' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: activeMode === 'edit' ? '#0f172a' : '#64748b',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                onClick={() => setActiveMode('edit')}
              >
                📝 JSON 配置编辑
              </button>
              <button
                type="button"
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  borderRadius: '6px',
                  background: activeMode === 'preview' ? '#ffffff' : 'transparent',
                  fontWeight: activeMode === 'preview' ? 600 : 400,
                  boxShadow: activeMode === 'preview' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: activeMode === 'preview' ? '#0f172a' : '#64748b',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                onClick={() => setActiveMode('preview')}
              >
                👁️ JSON 实时预览
              </button>
            </div>

            <button
              type="button"
              className="settings-action-btn is-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: '#165dff',
                color: '#fff',
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
              onClick={handleAddNewMcp}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              添加 MCP
            </button>
          </div>
        </div>
      </div>

      {notice ? (
        <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#16a34a', fontSize: '13px', fontWeight: 600 }}>
          {notice}
        </div>
      ) : null}
      {imaError ? <div role="alert" style={{ marginBottom: '16px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '13px' }}>
        ima 知识库：{imaError}
        <button type="button" onClick={() => void loadIma()} disabled={imaPending} style={{ marginLeft: '12px', color: '#165dff', border: 'none', background: 'none', cursor: 'pointer' }}>重试</button>
      </div> : null}

      {/* 视图 1：智能体与工具启用与关闭矩阵 */}
      {activeMode === 'matrix' ? (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <strong style={{ fontSize: '15px', color: '#0f172a' }}>智能体与工具启用与关闭矩阵 (Capability & Authorization Matrix)</strong>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                行代表智能体导师，列代表 MCP 工具服务与平台原生工具。在此勾选或取消勾选将即时同步至底层 MCP JSON 声明及运行时权限表。
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#165dff', background: '#eff6ff', padding: '4px 10px', borderRadius: '6px', fontWeight: 600 }}>
                已纳管 {activeAssistantsList.length} 位智能体 · {mcpList.length} 个 MCP 服务
              </span>
            </div>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0' }}>
                  <th style={{ padding: '14px 16px', fontWeight: 700, color: '#334155', minWidth: '170px' }}>智能体角色</th>
                  {mcpList.map((m) => (
                    <th key={m.id} style={{ padding: '12px 14px', fontWeight: 700, color: '#1e293b', textAlign: 'center', minWidth: '130px' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '11px', color: m.id === IMA_ID && m.status !== 'connected' ? '#94a3b8' : '#16a34a' }}>●</span>
                        <span>{m.id === IMA_ID ? '是否使用 ima 知识库' : m.name}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>{m.tools.length} 个工具{m.id === IMA_ID ? ` · ${ima ? ima.enabled ? '允许调用' : '总开关关闭' : '读取中'}` : ''}</div>
                    </th>
                  ))}
                  <th style={{ padding: '12px 14px', fontWeight: 700, color: '#4338ca', textAlign: 'center', minWidth: '120px' }}>
                    <div>🎨 图像生成</div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>原生 ImageGen</div>
                  </th>
                  <th style={{ padding: '12px 14px', fontWeight: 700, color: '#047857', textAlign: 'center', minWidth: '120px' }}>
                    <div>🐍 Python 沙箱</div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>原生 Sandbox</div>
                  </th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155', textAlign: 'center', minWidth: '130px' }}>批量快捷操作</th>
                </tr>
              </thead>
              <tbody>
                {activeAssistantsList.map((asst, index) => {
                  return (
                    <tr key={asst.id || asst.name} style={{ borderBottom: '1px solid #f1f5f9', background: index % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{asst.name}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          <span style={{ padding: '1px 6px', background: '#e2e8f0', borderRadius: '4px' }}>{asst.role || '智能导师'}</span>
                        </div>
                      </td>

                      {/* MCP 列 */}
                      {mcpList.map((m) => {
                        const isChecked = m.boundAssistants.some(
                          (identifier) => identifier === asst.name || identifier === asst.id
                        );
                        return (
                          <td key={m.id} style={{ padding: '12px 14px', textAlign: 'center' }}>
                            {m.id === IMA_ID ? <button
                              type="button" role="checkbox" aria-checked={isChecked}
                              aria-label={`${asst.name} 是否使用 ima 知识库`}
                              disabled={imaPending || !ima?.registered || !ima.assistants.some((row) => row.id === asst.id)}
                              onClick={() => void toggleImaAssistant(asst.id)}
                              title={!ima?.enabled ? '总开关已关闭；可预设助手授权' : `${asst.name}${isChecked ? '已授权' : '未授权'} ima 知识库`}
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '5px', border: isChecked ? '1.5px solid #165dff' : '1.5px solid #cbd5e1', background: isChecked ? '#165dff' : '#ffffff', color: '#ffffff', fontSize: '14px', fontWeight: 700, cursor: imaPending ? 'wait' : 'pointer', margin: '0 auto', padding: 0 }}
                            >{isChecked ? '✓' : ''}</button> : <div
                              onClick={() => toggleMcpForAssistant(m.name, asst.name)}
                              role="checkbox"
                              aria-checked={isChecked}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                borderRadius: '5px',
                                border: isChecked ? '1.5px solid #165dff' : '1.5px solid #cbd5e1',
                                background: isChecked ? '#165dff' : '#ffffff',
                                color: '#ffffff',
                                fontSize: '14px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease-in-out',
                                boxShadow: isChecked ? '0 1px 3px rgba(22, 93, 255, 0.25)' : 'none',
                                userSelect: 'none',
                                margin: '0 auto',
                              }}
                              title={
                                isChecked
                                  ? `${asst.name} 已授权 ${m.name} (点击取消打勾即刻关闭)`
                                  : `${asst.name} 未授权 ${m.name} (点击打上✔ 立即生效)`
                              }
                            >
                              {isChecked ? '✓' : ''}
                            </div>}
                          </td>
                        );
                      })}

                      {/* 图像生成 列 */}
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        {(() => {
                          const isChecked = imageGenAssistants.some(
                            (identifier) => identifier === asst.name || identifier === asst.id
                          );
                          return (
                            <div
                              onClick={() => toggleBuiltinToolForAssistant('imageGen', asst.name)}
                              role="checkbox"
                              aria-checked={isChecked}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                borderRadius: '5px',
                                border: isChecked ? '1.5px solid #7c3aed' : '1.5px solid #cbd5e1',
                                background: isChecked ? '#7c3aed' : '#ffffff',
                                color: '#ffffff',
                                fontSize: '14px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease-in-out',
                                boxShadow: isChecked ? '0 1px 3px rgba(124, 58, 237, 0.25)' : 'none',
                                userSelect: 'none',
                                margin: '0 auto',
                              }}
                              title={
                                isChecked
                                  ? `${asst.name} 已授权图像生成 (点击取消打勾即刻关闭)`
                                  : `${asst.name} 未授权图像生成 (点击打上✔ 立即生效)`
                              }
                            >
                              {isChecked ? '✓' : ''}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Python 沙箱 列 */}
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        {(() => {
                          const isChecked = sandboxAssistants.some(
                            (identifier) => identifier === asst.name || identifier === asst.id
                          );
                          return (
                            <div
                              onClick={() => toggleBuiltinToolForAssistant('sandbox', asst.name)}
                              role="checkbox"
                              aria-checked={isChecked}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                borderRadius: '5px',
                                border: isChecked ? '1.5px solid #059669' : '1.5px solid #cbd5e1',
                                background: isChecked ? '#059669' : '#ffffff',
                                color: '#ffffff',
                                fontSize: '14px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease-in-out',
                                boxShadow: isChecked ? '0 1px 3px rgba(5, 150, 105, 0.25)' : 'none',
                                userSelect: 'none',
                                margin: '0 auto',
                              }}
                              title={
                                isChecked
                                  ? `${asst.name} 已授权 Python 沙箱 (点击取消打勾即刻关闭)`
                                  : `${asst.name} 未授权 Python 沙箱 (点击打上✔ 立即生效)`
                              }
                            >
                              {isChecked ? '✓' : ''}
                            </div>
                          );
                        })()}
                      </td>

                      {/* 批量操作 */}
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => grantAllToolsForAssistant(asst.name)}
                            style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', color: '#165dff', cursor: 'pointer', fontWeight: 600 }}
                          >
                            全选
                          </button>
                          <button
                            type="button"
                            onClick={() => revokeAllToolsForAssistant(asst.name)}
                            style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', color: '#ef4444', cursor: 'pointer' }}
                          >
                            清空
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* 视图 2 & 3：JSON 配置编辑与实时预览工作台 */
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '18px', alignItems: 'start' }}>
        {/* 左侧目标选择列表 */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>配置目标与清单</span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>切换编辑对象</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* 1. 总的设置入口 */}
            <div
              onClick={() => setSelectedTarget('global')}
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                cursor: 'pointer',
                background: selectedTarget === 'global' ? '#eff6ff' : '#ffffff',
                border: selectedTarget === 'global' ? '1.5px solid #165dff' : '1px solid #e2e8f0',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '14px' }}>🌐</span>
                  <strong style={{ fontSize: '13.5px', color: selectedTarget === 'global' ? '#165dff' : '#0f172a' }}>
                    总配置 (mcpServers 全局)
                  </strong>
                </div>
                <span style={{ fontSize: '11px', background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                  全景
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                统一管理包含 {mcpList.length} 个 MCP 服务器的完整 JSON 配置
              </div>
            </div>

            <div style={{ height: '1px', background: '#f1f5f9', margin: '4px 0' }} />
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', padding: '2px 4px' }}>
              单个 MCP 独立设置 (点击单独配置)
            </div>

            {/* 2. 各个独立的 MCP */}
            {mcpList.map((mcp) => {
              const isSelected = selectedTarget === mcp.id;
              return (
                <div
                  key={mcp.id}
                  onClick={() => setSelectedTarget(mcp.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    background: isSelected ? '#f0f7ff' : '#ffffff',
                    border: isSelected ? '1.5px solid #165dff' : '1px solid #e2e8f0',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: isSelected ? '#165dff' : '#64748b', fontSize: '12px' }}>▶</span>
                      <strong style={{ fontSize: '13.5px', color: isSelected ? '#165dff' : '#0f172a' }}>{mcp.name}</strong>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: mcp.id === IMA_ID && mcp.status !== 'connected' ? '#64748b' : '#16a34a', background: mcp.id === IMA_ID && mcp.status !== 'connected' ? '#f1f5f9' : '#ecfdf5', padding: '1px 6px', borderRadius: '999px', fontWeight: 600 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {mcp.id === IMA_ID ? imaPending ? '读取中' : !ima ? '待读取' : !ima.registered ? '未注册' : mcp.status === 'connected' ? '连接正常' : mcp.status === 'error' ? '连接失败' : '待检查' : `${mcp.latencyMs ?? 20}ms`}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                    {mcp.description || `${mcp.command} ${(mcp.args || []).join(' ')}`}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', fontSize: '11px', color: '#94a3b8' }}>
                    <span>{mcp.tools.length} 个工具</span>
                    <span>·</span>
                    <span>{mcp.boundAssistants.length} 个智能体绑定</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧：合并为单一工作台（顶层按钮切换 编辑 / 预览） */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          {/* 标题栏 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingBottom: '14px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>{selectedTarget === 'global' ? '🌐' : '⚙️'}</span>
              <div>
                <strong style={{ fontSize: '15px', color: '#0f172a' }}>
                  {selectedTarget === 'global' ? 'mcpServers.json (总配置)' : `${currentSingleMcp?.name}.json (单独配置)`}
                </strong>
                <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>
                  {activeMode === 'edit' ? '当前处于 JSON 源码编辑态' : '当前处于 结构化解析预览态'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {currentSingleMcp?.id === IMA_ID ? <>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#475569' }}>
                  <input type="checkbox" role="switch" aria-label="允许调用 ima 知识库" checked={ima?.enabled ?? false} disabled={imaPending || !ima?.registered} onChange={(event) => void saveIma({ enabled: event.target.checked })} style={{ accentColor: '#165dff' }} />允许调用
                </label>
                <button type="button" disabled={imaPending || !ima?.registered} onClick={() => void checkIma()} style={{ fontSize: '12px', padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer' }}>检查连接</button>
              </> : currentSingleMcp ? (
                <button
                  type="button"
                  onClick={() => handleDeleteCurrentMcp(currentSingleMcp.id, currentSingleMcp.name)}
                  title="删除此 MCP 配置"
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#dc2626',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🗑️ 删除该 MCP
                </button>
              ) : null}

              {activeMode === 'edit' && (
                <>
                  <button
                    type="button"
                    style={{ fontSize: '12px', padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer' }}
                    onClick={handleFormatJson}
                  >
                    ✨ 格式化 JSON
                  </button>
                  <button
                    type="button"
                    style={{ fontSize: '12px', padding: '5px 14px', border: 'none', borderRadius: '6px', background: '#165dff', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => void handleSaveJson()}
                    disabled={imaPending || ((selectedTarget === IMA_ID || selectedTarget === 'global') && !ima?.registered)}
                  >
                    💾 保存配置
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 错误提示 */}
          {jsonError ? (
            <div style={{ marginTop: '12px', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', fontSize: '12.5px' }}>
              ⚠️ {jsonError}
            </div>
          ) : null}

          {/* 核心视图切换：编辑模式 vs 预览模式（合并为单一容器） */}
          {activeMode === 'edit' ? (
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>
                {selectedTarget === 'global'
                  ? '修改全局 mcpServers 结构，支持一次性批量配置所有 MCP 的命令、参数与环境变量。'
                  : selectedTarget === IMA_ID ? '修改 enabled 与 boundAssistants（助手 ID）。协议、工具清单和连接凭证由服务器管理。' : `单独配置【${currentSingleMcp?.name}】的 command、args、env 与 boundAssistants。`}
              </div>

              <textarea
                aria-label={selectedTarget === IMA_ID ? 'ima 知识库 JSON 配置' : 'MCP JSON 配置'}
                disabled={selectedTarget === IMA_ID && (imaPending || !ima?.registered)}
                value={jsonTextDraft}
                onChange={(e) => {
                  setJsonTextDraft(e.target.value);
                  setJsonError(null);
                }}
                spellCheck={false}
                style={{
                  width: '100%',
                  height: '400px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />
            </div>
          ) : (
            /* 预览模式：结构化解析展示 */
            <div style={{ marginTop: '14px' }}>
              {selectedTarget === 'global' ? (
                /* 全局预览卡片 */
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                    {mcpList.map((item) => (
                      <div key={item.id} style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '13px', color: '#0f172a' }}>{item.name}</strong>
                          <span style={{ fontSize: '11px', color: item.id === IMA_ID && item.status !== 'connected' ? '#64748b' : '#16a34a', fontWeight: 600 }}>● {item.id === IMA_ID ? item.status === 'connected' ? '连接正常' : item.status === 'error' ? '连接失败' : '待检查' : '在线'}</span>
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
                          {item.tools.length} 工具 · {item.boundAssistants.length} 助手
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    当前生效的全局 JSON 结构
                  </div>
                  <pre style={{
                    margin: 0,
                    background: '#0f172a',
                    color: '#e2e8f0',
                    padding: '14px',
                    borderRadius: '8px',
                    fontSize: '12.5px',
                    fontFamily: 'ui-monospace, monospace',
                    overflowX: 'auto',
                    maxHeight: '320px',
                    lineHeight: 1.5,
                  }}>
                    {jsonTextDraft}
                  </pre>
                </div>
              ) : currentSingleMcp ? (
                /* 单独 MCP 预览卡片 */
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '14px' }}>
                    <div style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{selectedTarget === IMA_ID ? '知识库调用状态' : '运行命令与参数'}</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginTop: '2px', fontFamily: 'monospace' }}>
                        {selectedTarget === IMA_ID ? ima?.enabled ? '允许调用 · 仅限已授权助手' : '总开关已关闭' : `${currentSingleMcp.command} ${(currentSingleMcp.args || []).join(' ')}`}
                      </div>
                    </div>

                    <div style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>协议通道 & 心跳延迟</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#16a34a', marginTop: '2px' }}>
                        ● {currentSingleMcp.transport ?? 'stdio'} 通道 {selectedTarget === IMA_ID ? `（${currentSingleMcp.status === 'connected' ? '连接正常' : currentSingleMcp.status === 'error' ? '连接失败' : '待检查'}）` : `(${currentSingleMcp.latencyMs ?? 20}ms)`}
                      </div>
                    </div>
                  </div>

                  {/* 暴露的工具列表 */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                      暴露的 MCP 工具清单 ({currentSingleMcp.tools.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {currentSingleMcp.tools.map((tool) => (
                        <span key={tool} style={{ padding: '3px 8px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '12px', color: '#1d4ed8', fontFamily: 'monospace' }}>
                          ⚡ {tool}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 原始 JSON 视图 */}
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                      该 MCP 的独立 JSON 配置
                    </div>
                    <pre style={{
                      margin: 0,
                      background: '#0f172a',
                      color: '#e2e8f0',
                      padding: '14px',
                      borderRadius: '8px',
                      fontSize: '12.5px',
                      fontFamily: 'ui-monospace, monospace',
                      overflowX: 'auto',
                      maxHeight: '260px',
                      lineHeight: 1.5,
                    }}>
                      {jsonTextDraft}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* 如果是单 MCP，展示智能体绑定控制 */}
          {currentSingleMcp ? (
            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>已授权使用【{currentSingleMcp.name}】的智能体</strong>
                <span style={{ fontSize: '11px', color: '#64748b' }}>点击标签直接切换绑定</span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {(assistants.length > 0 ? assistants.map((a) => a.name) : ['雷霆战机总导师', '动手学动能定理总导师', '代码向导与答辩导师', '原理教练', '评审导师']).map((asstName) => {
                  const isBound = currentSingleMcp.boundAssistants.includes(asstName);
                  return (
                    <button
                      key={asstName}
                      type="button"
                      onClick={() => toggleAssistantBinding(asstName)}
                      disabled={currentSingleMcp.id === IMA_ID && (imaPending || !ima?.registered)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        background: isBound ? '#165dff' : '#f1f5f9',
                        color: isBound ? '#ffffff' : '#475569',
                        border: isBound ? '1px solid #165dff' : '1px solid #cbd5e1',
                        fontWeight: isBound ? 600 : 400,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {isBound ? '✓' : '+'} {asstName}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      )}

      {/* 模块二：内置工具（图像生成与沙箱）卡片，严格对应 AdminUI/工具.png 视觉 */}
      <div style={{ marginTop: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <strong style={{ fontSize: '15px', color: '#0f172a' }}>内置工具 (Builtin Tools)</strong>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              配置 MCP 服务器与内置工具（如图像生成与代码沙箱）。图像生成需先在“模型”页配置支持图像的模型后才能启用。
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 图像生成 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>图像生成 (ImageGen)</strong>
                <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: '#e0e7ff', color: '#4338ca', fontWeight: 600 }}>平台原生</span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                图像模型：暂无可用本地图像模型，<a href="/settings/models" style={{ color: '#165dff', textDecoration: 'none' }}>前往配置 ⓘ</a>
              </div>
            </div>

            <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
              <input
                type="checkbox"
                checked={imageGenEnabled}
                onChange={(e) => setImageGenEnabled(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: imageGenEnabled ? '#165dff' : '#cbd5e1',
                  transition: '.3s',
                  borderRadius: '22px',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    content: '""',
                    height: '16px',
                    width: '16px',
                    left: imageGenEnabled ? '21px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '.3s',
                    borderRadius: '50%',
                  }}
                />
              </span>
            </label>
          </div>

          {/* Python 代码沙箱 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Python 运行沙箱 (Sandbox)</strong>
                <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: '#ecfdf5', color: '#047857', fontWeight: 600 }}>安全隔离</span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                用于学生代码执行、物理公式数值仿真与游戏逻辑运行测试。
              </div>
            </div>

            <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
              <input
                type="checkbox"
                checked={sandboxEnabled}
                onChange={(e) => setSandboxEnabled(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: sandboxEnabled ? '#165dff' : '#cbd5e1',
                  transition: '.3s',
                  borderRadius: '22px',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    content: '""',
                    height: '16px',
                    width: '16px',
                    left: sandboxEnabled ? '21px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '.3s',
                    borderRadius: '50%',
                  }}
                />
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
