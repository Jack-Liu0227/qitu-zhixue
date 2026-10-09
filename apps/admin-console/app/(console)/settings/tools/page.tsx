'use client';

import { useMemo, useState } from 'react';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

interface ToolItem {
  id: string;
  name: string;
  type: 'builtin' | 'mcp';
  description: string;
  status: 'ready' | 'pending';
  toolCount: number;
}

const REGISTERED_TOOLS: ToolItem[] = [
  {
    id: 'python-sandbox',
    name: 'Python 3.12 执行沙箱',
    type: 'builtin',
    description: '安全隔离的代码运行容器，支持 Pygame 依赖预检、单元测试执行与 stdout/stderr 捕获。',
    status: 'ready',
    toolCount: 3,
  },
  {
    id: 'image-generation',
    name: '图像生成与战机资产渲染',
    type: 'builtin',
    description: '内置图片生成服务，支持生成战机精灵图、爆炸特效序列帧与关卡背景图。',
    status: 'ready',
    toolCount: 2,
  },
  {
    id: 'project-file-manager',
    name: '学生工程文件管理器',
    type: 'builtin',
    description: '受限的项目工作区文件读写工具，支持代码文件树浏览与断点保存。',
    status: 'ready',
    toolCount: 4,
  },
  {
    id: 'web-research-mcp',
    name: 'Web 检索与知识库 MCP Server',
    type: 'mcp',
    description: '连接外部知识检索接口，提供游戏设计范例、Pygame 文档查询与错误码速查。',
    status: 'pending',
    toolCount: 2,
  },
];

export default function ToolsSettingsPage() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [testingId, setTestingId] = useState<string | null>(null);

  const tabs = useMemo(() => {
    const readyCount = REGISTERED_TOOLS.filter((t) => t.status === 'ready').length;
    const pendingCount = REGISTERED_TOOLS.filter((t) => t.status === 'pending').length;
    return [
      { id: 'all', label: '全部', count: REGISTERED_TOOLS.length },
      { id: 'ready', label: '可用', count: readyCount },
      { id: 'pending', label: '待配置', count: pendingCount },
    ];
  }, []);

  const filtered = useMemo(() => {
    return REGISTERED_TOOLS.filter((tool) => {
      if (activeTab === 'ready' && tool.status !== 'ready') return false;
      if (activeTab === 'pending' && tool.status !== 'pending') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [search, activeTab]);

  const handleTest = (id: string) => {
    setTestingId(id);
    setTimeout(() => {
      setTestingId(null);
      alert(`工具/MCP Server [${id}] 连接测试成功，心跳延迟 28ms！`);
    }, 600);
  };

  return (
    <AionSettingsParadigm
      title="工具"
      description={
        <span>
          管理 MCP Server 工具连接与服务端内置工具。支持沙箱命令执行、图像生成与外部 API 桥接。
          <a href="#">查看 MCP 工具文档</a>
        </span>
      }
      searchPlaceholder="搜索工具..."
      searchQuery={search}
      onSearchChange={setSearch}
      primaryActionLabel="添加 MCP 工具"
      onPrimaryAction={() => alert('已打开 MCP Server 配置向导')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {filtered.length === 0 ? (
        <div className="settings-empty">暂无匹配的工具或 MCP Server</div>
      ) : (
        filtered.map((tool) => (
          <RowCard
            key={tool.id}
            avatarText="🧰"
            avatarBg={tool.type === 'builtin' ? '#165dff' : '#00b42a'}
            name={tool.name}
            statusText={tool.status === 'ready' ? '可用' : '未安装'}
            statusType={tool.status === 'ready' ? 'ok' : 'off'}
            description={`${tool.description} (包含 ${tool.toolCount} 个函数)`}
            testLabel="测试连接"
            testLoading={testingId === tool.id}
            onTestConnection={() => handleTest(tool.id)}
            editLabel="配置"
            onEdit={() => alert(`编辑工具 ${tool.name} 的运行时参数`)}
          />
        ))
      )}
    </AionSettingsParadigm>
  );
}
