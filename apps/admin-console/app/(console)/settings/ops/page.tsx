'use client';

import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

export default function OpsSettingsPage() {
  return (
    <AionSettingsParadigm
      title="沉浸运维"
      description="实时监控平台后端网关、模型推理连接与 WebSocket 事件总线运行状况。"
      searchQuery=""
      onSearchChange={() => {}}
      primaryActionLabel="刷新监控"
      onPrimaryAction={() => alert('已刷新运行时指标')}
    >
      <RowCard
        avatarText="🌐"
        name="API 网关服务 (api-gateway)"
        statusText="健康 (200)"
        statusType="ok"
        description="NestJS 单体内核 · 运行端口 4100 · 响应时间 12ms"
        editLabel="查看日志"
        onEdit={() => alert('日志面板已开启')}
      />
      <RowCard
        avatarText="⚡"
        name="实时事件网关 (realtime-gateway)"
        statusText="健康 (SSE)"
        statusType="ok"
        description="Tutor SSE 流式传输适配器 · 活跃通道 4"
        editLabel="查看连接"
        onEdit={() => alert('流式通道详情')}
      />
    </AionSettingsParadigm>
  );
}
