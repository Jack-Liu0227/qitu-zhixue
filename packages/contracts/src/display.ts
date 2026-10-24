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

const CANONICAL_PROJECT_TITLES: Record<string, string> = {
  'optics-physical-inquiry': '光为什么会出现明暗条纹？干涉与衍射探究 · 从基础开始',
  'optics-physical-inquiry:v1': '光为什么会出现明暗条纹？干涉与衍射探究 · 从基础开始',
  'wave-interference-diffraction-8s-zero-base': '光为什么会出现明暗条纹？干涉与衍射探究 · 从基础开始',
  'wave-optics': '光为什么会出现明暗条纹？干涉与衍射探究 · 从基础开始',
  'thunder-fighter': '雷霆战机',
  'thunder-fighter-game': '雷霆战机',
  'python-mini-project': 'Python 趣味小项目',
  'story-game': '互动故事游戏创作',
  'kinetic-energy-inquiry': '动手学动能定理：物理虚拟仿真与规律探究',
  'kinetic-energy': '动手学动能定理：物理虚拟仿真与规律探究',
  'eco-bottle-carbon-cycle': '校园微生态瓶的建立与碳氧平衡微观测',
  'smart-green-architecture': '低碳未来社区：被动式绿色采光与节能建筑设计',
  'youth-screen-health-survey': '青少年屏幕使用时间与作息健康统计探究',
  'mortise-tenon-digital-craft': '中华古建筑榫卯结构数字化三维复原',
};

const CANONICAL_ARTIFACT_TITLES: Record<string, string> = {
  'Optics Physical Inquiry Formal Portfolio': '光学物理探究成果集：干涉与衍射探究',
  'Double-slit Interference and Single-slit Diffraction Research Report': '双缝干涉与单缝衍射实验研究报告',
  'Isolated interference and diffraction portfolio': '干涉与衍射独立探究成果集',
  'Wave Optics Interference & Diffraction Final Portfolio': '波动光学干涉与衍射结项成果集',
  'Optics Physical Inquiry Capstone Scientific Report': '光学物理探究结项科学报告',
};

/**
 * 统一家长端、教师端、Admin端与学生端项目名称呈现，保证全部使用规范中文。
 */
export function normalizeProjectTitle(title: string | null | undefined): string {
  if (!title || !title.trim()) return '未命名项目';
  const trimmed = title.trim();
  if (CANONICAL_PROJECT_TITLES[trimmed]) return CANONICAL_PROJECT_TITLES[trimmed];

  const lower = trimmed.toLowerCase();
  if (lower.includes('optics') || lower.includes('double-slit') || lower.includes('diffraction') || lower.includes('interference') || lower.includes('wave')) {
    return '光为什么会出现明暗条纹？干涉与衍射探究 · 从基础开始';
  }
  if (lower.includes('thunder') || lower.includes('fighter')) {
    return '雷霆战机';
  }
  if (lower.includes('python')) {
    return 'Python 趣味小项目';
  }
  if (lower.includes('kinetic')) {
    return '动手学动能定理：物理虚拟仿真与规律探究';
  }
  return trimmed;
}

/**
 * 规范化学生作品展厅与审核列表中的作品成果名称，消除历史英文测试记录。
 */
export function normalizeArtifactTitle(title: string | null | undefined): string {
  if (!title || !title.trim()) return '未命名作品成果';
  const trimmed = title.trim();
  if (CANONICAL_ARTIFACT_TITLES[trimmed]) return CANONICAL_ARTIFACT_TITLES[trimmed];

  const lower = trimmed.toLowerCase();
  if (lower.includes('capstone') && (lower.includes('report') || lower.includes('optics'))) {
    return '光学物理探究结项科学报告';
  }
  if (lower.includes('wave optics') || (lower.includes('interference') && lower.includes('diffraction') && lower.includes('final'))) {
    return '波动光学干涉与衍射结项成果集';
  }
  if (lower.includes('portfolio') || lower.includes('optics')) {
    return '光学物理探究成果集：干涉与衍射探究';
  }
  if (lower.includes('research report') || lower.includes('double-slit')) {
    return '双缝干涉与单缝衍射实验研究报告';
  }
  if (lower.includes('game.py') || lower.includes('playable game') || lower.includes('thunder')) {
    return '雷霆战机可玩小游戏交付成果';
  }
  return trimmed;
}
