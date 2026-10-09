'use client';

import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

export default function AccountSettingsPage() {
  return (
    <AionSettingsParadigm
      title="账号设置"
      description="管理当前管理员账户信息、安全认证与凭据密钥。"
      searchQuery=""
      onSearchChange={() => {}}
      primaryActionLabel="修改密码"
      onPrimaryAction={() => alert('已开启安全认证窗口')}
    >
      <RowCard
        avatarText="👤"
        name="管理员账户 (admin)"
        statusText="活跃"
        statusType="ok"
        description="角色：平台超级管理员 · 邮箱：admin@qitu.edu.cn"
        editLabel="编辑信息"
        onEdit={() => alert('编辑账户信息')}
      />
    </AionSettingsParadigm>
  );
}
