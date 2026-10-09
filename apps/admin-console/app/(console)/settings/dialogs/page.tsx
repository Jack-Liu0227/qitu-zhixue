'use client';

import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

export default function DialogsSettingsPage() {
  return (
    <AionSettingsParadigm
      title="已安装的对话"
      description="管理已登记的预制对话模板、角色提示词与学生交互场景。"
      searchQuery=""
      onSearchChange={() => {}}
      primaryActionLabel="新建对话模板"
      onPrimaryAction={() => alert('新建对话向导')}
    >
      <RowCard
        avatarText="💬"
        name="雷霆战机概念与架构引导对话"
        statusText="可用"
        statusType="ok"
        description="针对小学高年级及初中生的 PBL 游戏启发对话流 · 4 阶段设计"
        editLabel="查看剧本"
        onEdit={() => alert('对话流编辑器')}
      />
    </AionSettingsParadigm>
  );
}
