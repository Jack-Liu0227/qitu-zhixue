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
    <p role="status" className={styles.nextStep}>下一步：{next}</p>
    {draft && <dl className={styles.summaryGrid}>
      <div><dt>教学角色</dt><dd>{draft.roleMap.length} 位</dd></div>
      <div><dt>课时路由</dt><dd>{draft.sessionRoutes?.length ?? 0} 课时</dd></div>
      <div><dt>知识库范围</dt><dd>{draft.knowledgeBaseIds.length ? `已配置 ${draft.knowledgeBaseIds.length} 个库，仍需运行时授权校验` : '尚未授权知识库；不会自动访问全部资料'}</dd></div>
    </dl>}
    <p className={styles.guidanceNote}>逐课导师及固定开场在“课时教学主线”中编辑；模型、教学方法与资料范围可在下方按导师核对。团队版本发布时同步运行配置。</p>
  </>;
}
