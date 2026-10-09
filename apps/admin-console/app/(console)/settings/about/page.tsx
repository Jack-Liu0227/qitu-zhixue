'use client';

import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

export default function AboutSettingsPage() {
  return (
    <AionSettingsParadigm
      title="关于"
      description="启途智学平台软件版本、开源许可与架构规范说明。"
      searchQuery=""
      onSearchChange={() => {}}
      primaryActionLabel="检查更新"
      onPrimaryAction={() => alert('当前为最新版本 v0.1.0-alpha')}
    >
      <RowCard
        avatarText="✦"
        avatarBg="#165dff"
        name="启途智学 (Qitu Zhixue) Monorepo"
        statusText="v0.1.0"
        statusType="ok"
        description="基于多智能体协同与 PBL 探究式教学的青少年 AI 编程平台。"
        editLabel="技术文档"
        onEdit={() => window.open('https://github.com/Jack-Liu0227/qitu-zhixue', '_blank')}
      />
    </AionSettingsParadigm>
  );
}
