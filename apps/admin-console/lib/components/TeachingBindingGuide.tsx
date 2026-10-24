import type { TeachingBundleDraft } from '@qitu/contracts';
import styles from './teaching-binding/TeachingBinding.module.css';

export function TeachingBindingGuide({ selected, draft, ready, canActivate }: {
  selected: boolean; draft?: TeachingBundleDraft | null; ready: boolean; canActivate: boolean;
}) {
  const current = !selected ? 0 : !draft ? 1 : !ready ? 2 : 3;
  const steps = [
    ['选择团队', selected ? '使用已有团队及其助手' : '从团队管理中选择'],
    ['安排课时', draft ? `已保存 ${draft.sessionAssignments?.length ?? draft.sessionRoutes?.length ?? 0} 个课时` : '逐课选择团队或助手并保存'],
    ['核对资料', draft ? '核对教学能力与知识库范围' : '沿用团队的教学能力'],
    ['检查与启用', ready ? '已确认生效' : canActivate ? '校验通过后启用' : '课程发布后可启用'],
  ];
  const next = !selected ? '选择已有团队，然后安排各课的教学者。'
    : !draft ? '完成逐课选择，再点击“保存教学安排”。'
      : !ready ? canActivate ? '核对资料范围，再点击“校验并启用绑定”。' : '课程进入试点或发布状态后可启用。'
        : '教学安排已生效。更改团队或助手后重新保存，不会自动改变已有学生项目。';
  return <>
    <ol className={styles.steps} aria-label="教学配置进度">
      {steps.map(([title, detail], index) => <li key={title} className={index === current ? styles.currentStep : undefined}
        aria-current={index === current ? 'step' : undefined}>
        <span className={styles.stepNumber}>{index < current ? '✓' : index + 1}</span><span><strong>{title}</strong><small>{detail}</small></span>
      </li>)}
    </ol>
    <p role="status" className={styles.nextStep}>下一步：{next}</p>
    {draft && <dl className={styles.summaryGrid}>
      <div><dt>默认团队角色</dt><dd>{draft.roleMap.length} 位</dd></div>
      <div><dt>课时安排</dt><dd>{draft.sessionAssignments?.length ?? draft.sessionRoutes?.length ?? 0} 课时</dd></div>
      <div><dt>知识库范围</dt><dd>{draft.knowledgeBaseIds.length ? `已配置 ${draft.knowledgeBaseIds.length} 个库` : '尚未授权知识库'}</dd></div>
    </dl>}
    <p className={styles.guidanceNote}>团队与助手在团队管理中维护；这里负责课程使用和逐课分配。保存时自动记录教学配置，启用前由服务端检查。</p>
  </>;
}
