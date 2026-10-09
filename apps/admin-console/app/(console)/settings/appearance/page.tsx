'use client';

import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

export default function AppearanceSettingsPage() {
  return (
    <AionSettingsParadigm
      title="外观"
      description="管理管理后台与学生端的主题色彩、字号与动效偏好。"
      searchQuery=""
      onSearchChange={() => {}}
      primaryActionLabel="重置默认"
      onPrimaryAction={() => alert('已重置主题设置')}
    >
      <RowCard
        avatarText="🖥️"
        name="深浅色主题模式"
        statusText="跟随系统"
        statusType="ok"
        description="当前自动跟随操作系统深浅色设置（明亮 / 暗黑）。"
        editLabel="切换"
        onEdit={() => alert('已切换主题')}
      />
      <RowCard
        avatarText="🎨"
        name="品牌主题色"
        statusText="#165DFF"
        statusType="custom"
        description="系统默认主色调：Aion 蓝 / 极光蓝。"
        editLabel="自定义"
        onEdit={() => alert('调色板已开启')}
      />
    </AionSettingsParadigm>
  );
}
