import type { ProjectStage } from './project.js';

const stageLabels: Record<ProjectStage, string> = {
  exploration: '自由探索', intent_confirmed: '项目已确认', theory_learning: '理论探究',
  theory_check: '理解检查', practice_ready: '准备实践', practice_building: '实践制作',
  artifact_review: '作品待反馈', reflection: '反思完善', published: '作品已发布', completed: '项目已完成',
};

export function projectStageLabel(stage: string | null | undefined): string {
  return stage ? stageLabels[stage as ProjectStage] ?? '状态待确认' : '尚未开始';
}

export function subjectLabel(subject: string): string {
  const labels: Record<string, string> = { physics_optics: '物理 · 光学', physics_mechanics: '物理 · 力学', programming_game_dev: '游戏开发', programming: '编程', design: '设计', art: '艺术', physics: '物理', science: '科学探究', mathematics: '数学', engineering: '工程设计' };
  return labels[subject] ?? (/^[a-z_]+$/.test(subject) ? '学科待标注' : subject);
}

/** Translate known technical copy for learners without changing the frozen template. */
export function studentTemplateSummary(summary: string): string {
  return summary.replaceAll('检查点不自动产生掌握或作品通过事实', '每次检查会帮助你了解进展；理解情况和作品还需要依据探究证据确认')
    .replaceAll('TheoryMastered', '理论理解通过确认');
}

/** School calendar currently follows China Standard Time, independent of browser timezone. */
export function schoolDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
