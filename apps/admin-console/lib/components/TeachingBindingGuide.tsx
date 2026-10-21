import type { TeachingBundleDraft } from '@qitu/contracts';

export function TeachingBindingGuide({ published, saved, draft, ready, canActivate }: {
  published: boolean; saved: boolean; draft?: TeachingBundleDraft | null; ready: boolean; canActivate: boolean;
}) {
  const next = !published ? '选择导师团队，点击“生成当前团队版本”。历史版本不能用于新教学绑定。'
    : !saved ? '点击“保存团队绑定”，建立当前课程版本的配置草稿。'
      : !draft ? '选择课时安排，核对各阶段导师，再点击“生成教学配置”。'
        : !ready ? canActivate ? '核对下方教学配置，再点击“校验并启用绑定”。' : '课程进入试点或发布状态后，才能校验并启用。'
          : '教学配置已就绪。需要恢复的旧项目，可在下方填写原因并逐个确认。';
  return <aside aria-label="教学配置操作指南" style={{ padding: 16, margin: '12px 0', background: '#f0f6ff', borderRadius: 12 }}>
    <strong>配置顺序</strong>
    <ol><li>发布团队版本 → 保存团队绑定</li><li>选择课时与导师 → 生成教学配置</li><li>核对配置 → 校验并启用</li><li>按需逐个恢复历史项目</li></ol>
    <p role="status">下一步：{next}</p>
    <p>注意：团队版本冻结的是 Admin 助手配置。Team Runtime 还需要同 ID 的运行时 Agent；只有助手、没有运行时 Agent 时，普通对话仍可继续，但团队委派不会启动。</p>
    {draft && <dl style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
      <div><dt>教学角色</dt><dd>{draft.roleMap.length} 位</dd></div>
      <div><dt>课时路由</dt><dd>{draft.sessionRoutes?.length ?? 0} 课时</dd></div>
      <div><dt>知识库范围</dt><dd>{draft.knowledgeBaseIds.length ? `已配置 ${draft.knowledgeBaseIds.length} 个库，仍需运行时授权校验` : '尚未授权知识库；不会自动访问全部资料'}</dd></div>
    </dl>}
    {draft && <details><summary>核对角色、模型与技能</summary><ul>{draft.roleMap.map(role => {
      const model = draft.modelByPurpose[role.roleSlotId]?.dialogue;
      return <li key={role.roleSlotId}>角色 {role.roleSlotId} · 成员 {role.memberId} · 对话模型 {model ? `${model.modelProviderId} / ${model.modelId}` : '未配置'} · 技能 {draft.skillPins.filter(pin => pin.roleSlotId === role.roleSlotId).map(pin => pin.canonicalId).join('、') || '无'}</li>;
    })}</ul></details>}
  </aside>;
}
