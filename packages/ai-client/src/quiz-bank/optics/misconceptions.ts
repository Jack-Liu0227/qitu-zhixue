/**
 * 光学迷思库（服务端私有，不下发）。
 *
 * 每个 `misconceptionTag` 是一个稳定、可归因的命名空间键；`errorTypeCode` 是
 * 审计/卡点归因用的短码。`conceptId` 指向内容层的规范概念键，`socraticHint`
 * 是**不泄答案**的苏格拉底式第一提示（问句收尾）。
 *
 * 映射来源：recon-pedagogy §3 迷思干扰项库。
 */

export interface MisconceptionRemediation {
  /** 稳定命名空间键（题库条目的 `misconceptionTag` 引用它）。 */
  misconceptionTag: string;
  /** 审计/错误类型短码。 */
  errorTypeCode: string;
  /** 应回到哪个概念重学。 */
  conceptId: string;
  /** 苏格拉底式第一提示：只给方向 / 反例情境，不泄答案。 */
  socraticHint: string;
}

export const MISCONCEPTION_REMEDIATIONS: readonly MisconceptionRemediation[] = [
  {
    misconceptionTag: 'optics.reflection.normal_baseline',
    errorTypeCode: 'reflection.normal_baseline',
    conceptId: 'optics.reflection.law',
    socraticHint: '如果把“镜面”换成“法线”，入射角和反射角是相对哪条线量的？',
  },
  {
    misconceptionTag: 'optics.reflection.reversibility',
    errorTypeCode: 'reflection.reversibility',
    conceptId: 'optics.reflection.law',
    socraticHint: '让光沿你测出的反射光方向倒着射回去，它会朝哪走？',
  },
  {
    misconceptionTag: 'optics.refraction.bend_direction',
    errorTypeCode: 'refraction.bend_direction',
    conceptId: 'optics.refraction.law',
    socraticHint: '光从光疏斜射入光密介质，是偏向还是远离法线？',
  },
  {
    misconceptionTag: 'optics.refraction.index_velocity',
    errorTypeCode: 'refraction.index_velocity',
    conceptId: 'optics.refraction.law',
    socraticHint: '折射率 n = c/v：n 越大，光速 v 是越大还是越小？',
  },
  {
    misconceptionTag: 'optics.tir.critical_angle_missing',
    errorTypeCode: 'tir.critical_angle_missing',
    conceptId: 'optics.tir.critical_angle',
    socraticHint: '全反射除了“光密到光疏”，还差哪个关于入射角的条件？',
  },
  {
    misconceptionTag: 'optics.tir.critical_angle_formula',
    errorTypeCode: 'tir.critical_angle_formula',
    conceptId: 'optics.tir.critical_angle',
    socraticHint: '临界角公式 sinC 等于什么？拿 n=1.5 代进去，sinC 还能大于 1 吗？',
  },
  {
    misconceptionTag: 'optics.lens.optical_center',
    errorTypeCode: 'lens.optical_center',
    conceptId: 'optics.lens.ray_rules',
    socraticHint: '通过透镜光心的光线，传播方向会变吗？',
  },
  {
    misconceptionTag: 'optics.lens.virtual_focus',
    errorTypeCode: 'lens.virtual_focus',
    conceptId: 'optics.lens.ray_rules',
    socraticHint: '凹透镜的焦点是实焦点还是虚焦点？它在入射侧还是出射侧？',
  },
];

export function remediationForMisconception(tag: string): MisconceptionRemediation | null {
  return MISCONCEPTION_REMEDIATIONS.find((entry) => entry.misconceptionTag === tag) ?? null;
}

/** 已知迷思标签集合，供题库覆盖不变量使用。 */
export function knownMisconceptionTag(tag: string): boolean {
  return remediationForMisconception(tag) !== null;
}
