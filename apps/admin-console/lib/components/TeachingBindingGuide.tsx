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
  return <ol className={styles.steps} aria-label="教学配置进度">
    {steps.map(([title, detail], index) => <li key={title} className={index === current ? styles.currentStep : undefined}
      aria-current={index === current ? 'step' : undefined}>
      <span className={styles.stepNumber}>{index < current ? '✓' : index + 1}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </li>)}
  </ol>;
}
