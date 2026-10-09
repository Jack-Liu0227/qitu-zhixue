'use client';

import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

export default function SystemSettingsPage() {
  return (
    <AionSettingsParadigm
      title="系统设置"
      description="管理数据库连接池配置、Redis 缓存与审计日志归档策略。"
      searchQuery=""
      onSearchChange={() => {}}
      primaryActionLabel="清空缓存"
      onPrimaryAction={() => alert('已触发缓存清理')}
    >
      <RowCard
        avatarText="⚙️"
        name="PostgreSQL 关系型数据库"
        statusText="已连接"
        statusType="ok"
        description="连接池状态：活跃 5 / 最大 20 · 慢查询审计已开启"
        editLabel="数据库状态"
        onEdit={() => alert('数据库健康检查')}
      />
      <RowCard
        avatarText="💾"
        name="Redis 缓存与分布式锁"
        statusText="已连接"
        statusType="ok"
        description="内存占用 18.4MB · 命中率 99.2%"
        editLabel="配置"
        onEdit={() => alert('Redis 参数设置')}
      />
    </AionSettingsParadigm>
  );
}
