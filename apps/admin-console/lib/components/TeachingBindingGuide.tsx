import type { TeachingBundleDraft } from '@qitu/contracts';
import styles from './teaching-binding/TeachingBinding.module.css';

export function TeachingBindingGuide({ published, saved, draft, ready, canActivate }: {
  published: boolean; saved: boolean; draft?: TeachingBundleDraft | null; ready: boolean; canActivate: boolean;
}) {
  const current = !published || !saved ? 0 : !draft ? 1 : !ready ? 2 : 3;
  const steps = [
    ['教学团队', published ? saved ? '团队版本已绑定' : '保存所选团队版本' : '选择并发布团队版本'],
    ['课程与课时', draft ? `已配置 ${draft.sessionRoutes?.length ?? 0} 个课时` : '选择排期，分配授课导师'],
    ['能力与资料', draft ? '核对模型、技能与资料范围' : '沿用团队已发布的教学能力'],
    ['检查与启用', ready ? '已确认生效' : canActivate ? '校验通过后启用' : '课程发布后可启用'],
  ];
  const next = !published ? '选择导师团队，点击“生成当前团队版本”。历史版本不能用于新教学绑定。'
    : !saved ? '点击“保存团队绑定”，建立当前课程版本的配置草稿。'
      : !draft ? '选择课时安排，核对各阶段导师，再点击“生成教学配置”。'
        : !ready ? canActivate ? '核对下方教学配置，再点击“校验并启用绑定”。' : '课程进入试点或发布状态后，才能校验并启用。'
          : '教学配置已就绪。需要恢复的旧项目，可在下方填写原因并逐个确认。';
  return <>
    <ol className={styles.steps} aria-label="教学配置进度">
      {steps.map(([title, detail], index) => <li key={title} className={index === current ? styles.currentStep : undefined}
        aria-current={index === current ? 'step' : undefined}>
        <span className={styles.stepNumber}>{index < current ? '✓' : index + 1}</span>
        <span><strong>{title}</strong><small>{detail}</small></span>
      </li>)}
    </ol>
    <p role="status" style={{ margin: '8px 0 0' }}>下一步：{next}</p>
    {draft && <dl style={{ display: 'flex', flexWrap: 'wrap', gap: 20, margin: '8px 0 0' }}>
      <div><dt>教学角色</dt><dd>{draft.roleMap.length} 位</dd></div>
      <div><dt>课时路由</dt><dd>{draft.sessionRoutes?.length ?? 0} 课时</dd></div>
      <div><dt>知识库范围</dt><dd>{draft.knowledgeBaseIds.length ? `已配置 ${draft.knowledgeBaseIds.length} 个库，仍需运行时授权校验` : '尚未授权知识库；不会自动访问全部资料'}</dd></div>
    </dl>}
    {draft && <details><summary>核对角色、模型与技能</summary><ul>{draft.roleMap.map(role => {
      const model = draft.modelByPurpose[role.roleSlotId]?.dialogue;
      return <li key={role.roleSlotId}>角色 {role.roleSlotId} · 成员 {role.memberId} · 对话模型 {model ? `${model.modelProviderId} / ${model.modelId}` : '未配置'} · 技能 {draft.skillPins.filter(pin => pin.roleSlotId === role.roleSlotId).map(pin => pin.canonicalId).join('、') || '无'}</li>;
    })}</ul></details>}
    <p style={{ margin: '8px 0 0' }}>注意：团队版本冻结的是 Admin 助手配置。Team Runtime 还需要同 ID 的运行时 Agent；只有助手、没有运行时 Agent 时，普通对话仍可继续，但团队委派不会启动。</p>
  </>;
}
