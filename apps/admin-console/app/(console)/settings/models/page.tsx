'use client';

import { useMemo, useState } from 'react';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

interface ModelItem {
  id: string;
  name: string;
  provider: string;
  status: 'ready' | 'pending';
  contextLength: string;
  associatedAgents: string[];
}

const REGISTERED_MODELS: ModelItem[] = [
  {
    id: 'qwen-2.5-coder-32b',
    name: 'Qwen 2.5 Coder 32B',
    provider: '通义千问',
    status: 'ready',
    contextLength: '128k',
    associatedAgents: ['总导师', '原理教练', '代码向导', '答辩导师'],
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1 (推理模型)',
    provider: '深度求索',
    status: 'ready',
    contextLength: '64k',
    associatedAgents: ['原理教练', '答辩导师'],
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o (多模态)',
    provider: 'OpenAI',
    status: 'ready',
    contextLength: '128k',
    associatedAgents: ['总导师'],
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    status: 'ready',
    contextLength: '200k',
    associatedAgents: ['代码向导'],
  },
  {
    id: 'glm-4-plus',
    name: 'GLM-4 Plus',
    provider: '智谱 AI',
    status: 'pending',
    contextLength: '128k',
    associatedAgents: [],
  },
  {
    id: 'kimi-moonshot-v1',
    name: 'Moonshot v1 128k',
    provider: '月之暗面',
    status: 'pending',
    contextLength: '128k',
    associatedAgents: [],
  },
];

export default function ModelsSettingsPage() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [testingId, setTestingId] = useState<string | null>(null);

  const tabs = useMemo(() => {
    const readyCount = REGISTERED_MODELS.filter((m) => m.status === 'ready').length;
    const pendingCount = REGISTERED_MODELS.filter((m) => m.status === 'pending').length;
    return [
      { id: 'all', label: '全部', count: REGISTERED_MODELS.length },
      { id: 'ready', label: '可用', count: readyCount },
      { id: 'pending', label: '待配置', count: pendingCount },
    ];
  }, []);

  const filtered = useMemo(() => {
    return REGISTERED_MODELS.filter((model) => {
      if (activeTab === 'ready' && model.status !== 'ready') return false;
      if (activeTab === 'pending' && model.status !== 'pending') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          model.name.toLowerCase().includes(q) ||
          model.provider.toLowerCase().includes(q) ||
          model.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [search, activeTab]);

  const handleTest = (id: string) => {
    setTestingId(id);
    setTimeout(() => {
      setTestingId(null);
      alert(`模型 ${id} 连通性测试成功，往返延迟 142ms！`);
    }, 600);
  };

  return (
    <AionSettingsParadigm
      title="模型"
      description={
        <span>
          管理已接入的 AI 大模型供应商、API 凭证鉴权与服务可用性。
          <a href="/admin/settings/model-providers">高级供应商配置</a>
        </span>
      }
      searchPlaceholder="搜索模型..."
      searchQuery={search}
      onSearchChange={setSearch}
      primaryActionLabel="添加模型供应商"
      onPrimaryAction={() => alert('请在供应商配置页面添加 API 凭证')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {filtered.length === 0 ? (
        <div className="settings-empty">暂无匹配的模型</div>
      ) : (
        filtered.map((model) => (
          <RowCard
            key={model.id}
            avatarText={model.name.slice(0, 1)}
            avatarBg={model.status === 'ready' ? '#165dff' : '#86909c'}
            name={model.name}
            statusText={model.status === 'ready' ? '可用' : '未安装'}
            statusType={model.status === 'ready' ? 'ok' : 'off'}
            description={`${model.provider} · 上下文 ${model.contextLength} · 关联 ${model.associatedAgents.length} 个助手`}
            avatarStack={model.associatedAgents.map((a) => a.slice(0, 1))}
            testLabel="测试连接"
            testLoading={testingId === model.id}
            onTestConnection={() => handleTest(model.id)}
            editLabel="编辑"
            onEdit={() => alert(`编辑模型 ${model.name} 参数与路由`)}
          />
        ))
      )}
    </AionSettingsParadigm>
  );
}
