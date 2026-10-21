export type VisualUsage = 'avatar' | 'icon' | 'cover' | 'illustration';
export type VisualCategory = 'assistant' | 'team' | 'template' | 'subject' | 'activity' | 'capability' | 'artifact' | 'growth' | 'support' | 'empty' | 'emotion' | 'brand';

export interface VisualAssetSummary {
  id: string;
  name: string;
  category: VisualCategory;
  usages: readonly VisualUsage[];
  motif: string;
}

function asset(id: string, name: string, category: VisualCategory, usage: VisualUsage, motif: string): VisualAssetSummary {
  return { id, name, category, usages: usage === 'illustration' ? ['illustration', 'cover'] : [usage], motif };
}

/** Public artwork catalog. IDs describe presentation only, never runtime authorization. */
export const VISUAL_ASSETS: readonly VisualAssetSummary[] = [
  asset('avatar-general-v1', '通用搭档', 'assistant', 'avatar', 'the original orbit crest, no extra accessories'),
  asset('avatar-explorer-v1', '探索发现', 'assistant', 'avatar', 'one large simple compass crest'),
  asset('avatar-concept-v1', '概念理解', 'assistant', 'avatar', 'one large open-book crest with a small light'),
  asset('avatar-experiment-v1', '实验探究', 'assistant', 'avatar', 'one large simplified microscope crest'),
  asset('avatar-coding-v1', '编程创造', 'assistant', 'avatar', 'one large modular coding-block crest'),
  asset('avatar-data-v1', '数据分析', 'assistant', 'avatar', 'one large three-bar data-chart crest'),
  asset('avatar-review-v1', '表达评议', 'assistant', 'avatar', 'one large speech-bubble and evidence-card crest'),
  asset('avatar-growth-v1', '成长陪伴', 'assistant', 'avatar', 'one large fresh sprout crest'),
  asset('avatar-coordinator-v1', '协作组织', 'assistant', 'avatar', 'one large connected-three-nodes crest'),
  asset('avatar-creative-v1', '创意设计', 'assistant', 'avatar', 'one large artist-palette crest'),
  asset('team-optics-v1', '光学协作', 'team', 'icon', 'three connected white and cobalt collaboration nodes surrounding a glass prism with one stylized cyan beam'),
  asset('team-kinetic-v1', '动能协作', 'team', 'icon', 'three connected collaboration nodes surrounding a small cart and a curved track'),
  asset('team-coding-v1', '编程协作', 'team', 'icon', 'three connected collaboration nodes surrounding modular coding blocks'),
  asset('template-optics-v1', '光学探究', 'template', 'icon', 'one glass prism with a clean stylized cyan light beam, thematic illustration not a measured diagram'),
  asset('template-kinetic-v1', '动能探究', 'template', 'icon', 'one small cobalt cart on a short tilted white laboratory track'),
  asset('template-coding-v1', '编程游戏', 'template', 'icon', 'one original friendly toy-like game spacecraft with modular coding blocks, no weapons'),
  asset('cover-optics-v1', '光学探究封面', 'template', 'cover', 'a simple tabletop optical inquiry scene with a prism, screen and enclosed observation chamber, decorative thematic scene with no measured data'),
  asset('cover-kinetic-v1', '动能探究封面', 'template', 'cover', 'a simple tabletop inquiry scene with a small cart, tilted track and a blank notebook, no measured data'),
  asset('cover-coding-v1', '编程创作封面', 'template', 'cover', 'a creative programming workbench with a blank screen displaying an original simple spacecraft game and modular blocks, no code or text'),
  asset('subject-physics-v1', '物理', 'subject', 'icon', 'a simple pendulum and a small glass prism'),
  asset('subject-coding-v1', '编程', 'subject', 'icon', 'a simple blank cobalt computer screen with three modular blocks'),
  asset('subject-engineering-v1', '工程', 'subject', 'icon', 'a simple interlocking gear and structural building block'),
  asset('subject-math-v1', '数学', 'subject', 'icon', 'a sphere, cube and geometric measuring compass, no numbers or formulas'),
  asset('subject-art-v1', '艺术', 'subject', 'icon', 'a simple paint palette and brush'),
  asset('subject-interdisciplinary-v1', '跨学科', 'subject', 'icon', 'three connected geometric shapes around a small light of discovery'),
  asset('activity-inquiry-v1', '提问探究', 'activity', 'icon', 'a magnifying glass examining a blank thought bubble'),
  asset('activity-concept-v1', '概念理解', 'activity', 'icon', 'an open blank book and one glowing discovery light'),
  asset('activity-experiment-v1', '实验观察', 'activity', 'icon', 'a simple microscope with one blank observation card'),
  asset('activity-reflection-v1', '表达反思', 'activity', 'icon', 'a blank notebook and a simple speech bubble'),
  asset('capability-knowledge-v1', '知识资料', 'capability', 'icon', 'three neatly arranged blank books and a small magnifier'),
  asset('capability-skills-v1', '教学技能', 'capability', 'icon', 'a simple connected set of three learning blocks and an open book'),
  asset('capability-tools-v1', '工具协作', 'capability', 'icon', 'a compact toolbox and two connected nodes'),
  asset('capability-growth-v1', '成长记录', 'capability', 'icon', 'a blank journal with a growing sprout'),
  asset('artifact-program-v1', '程序作品', 'artifact', 'cover', 'a simple blank computer screen with modular building blocks on a clean creative workbench'),
  asset('artifact-report-v1', '实验报告', 'artifact', 'cover', 'a blank scientific notebook, a small observation apparatus and tidy pencil, no charts or invented results'),
  asset('artifact-design-v1', '设计作品', 'artifact', 'cover', 'a folded paper model, geometric shapes and simple design tools'),
  asset('artifact-presentation-v1', '演示作品', 'artifact', 'cover', 'a simple presentation easel with blank cards and a small speaker podium'),
  asset('artifact-video-v1', '视频作品', 'artifact', 'cover', 'a simple cobalt camera and two blank storyboard frames'),
  asset('artifact-integrated-v1', '综合作品', 'artifact', 'cover', 'an open creative portfolio containing geometric models, blank pages and modular blocks'),
  asset('growth-milestone-v1', '项目里程碑', 'growth', 'icon', 'a small flag at a waypoint on a gently rising path, no award or completion checkmark'),
  asset('growth-artifact-v1', '作品记录', 'growth', 'icon', 'a small open display pedestal with an original geometric creation'),
  asset('growth-reflection-v1', '反思记录', 'growth', 'icon', 'a blank journal and a calm speech bubble'),
  asset('growth-objective-v1', '目标记录', 'growth', 'icon', 'a clear concentric target with a small light at its center, no checkmark or score'),
  asset('support-teacher-v1', '教师支持', 'support', 'illustration', 'a friendly abstract adult educator helping a learner examine a tabletop model, no identifiable real people'),
  asset('support-family-v1', '家校协作', 'support', 'illustration', 'two abstract adults and a learner sharing a blank learning notebook with a small robot companion, no identifiable people'),
  asset('support-review-v1', '共同回顾', 'support', 'illustration', 'a learner and friendly robot looking at blank project cards together, no scores or identifiable people'),
  asset('empty-explore-v1', '等待探索', 'empty', 'illustration', 'a friendly white and cobalt robot holding a compass beside a small unexplored path'),
  asset('empty-project-v1', '暂无项目', 'empty', 'illustration', 'a friendly robot beside an empty open project folder and a small discovery light'),
  asset('empty-artifact-v1', '暂无作品', 'empty', 'illustration', 'a friendly robot beside an empty creative display stand with a few clean building blocks'),
  asset('empty-search-v1', '无检索结果', 'empty', 'illustration', 'a friendly robot gently examining an empty open folder with a magnifying glass'),
  asset('emotion-thinking-v1', '思考中的搭档', 'emotion', 'illustration', 'the Qitu robot looking thoughtfully upward, with a single small thought bubble and no lettering'),
  asset('emotion-encourage-v1', '鼓励的搭档', 'emotion', 'illustration', 'the Qitu robot making a friendly supportive gesture beside a small glowing discovery light'),
  asset('emotion-celebrate-v1', '庆祝的搭档', 'emotion', 'illustration', 'the Qitu robot smiling with raised hands and three simple geometric confetti shapes, no trophy or achievement text'),
  asset('brand-pbl-v1', '项目式探究', 'brand', 'illustration', 'learners and a friendly small robot exploring a tabletop model with blank evidence cards and simple creative materials, no identifiable people'),
  asset('brand-collaboration-v1', '人机共成长', 'brand', 'illustration', 'a learner, an educator and a small friendly robot creating a geometric project together, no identifiable people'),
];

export const VISUAL_CATEGORY_LABELS: Record<VisualCategory, string> = {
  assistant: '助手头像', team: '团队', template: '项目主题', subject: '学科方向', activity: '教学活动',
  capability: '知识与工具', artifact: '作品', growth: '成长记录', support: '家校支持', empty: '空状态', emotion: '搭档情绪', brand: '品牌插画',
};

export function getVisualAsset(id: string | null | undefined): VisualAssetSummary | undefined {
  return VISUAL_ASSETS.find((item) => item.id === id?.replace(/^asset:/, ''));
}

export function visualToken(id: string): string { return `asset:${id}`; }

export type VisualOwner =
  | { kind: 'platform'; id: 'default' | 'assistant' | 'team' | 'template' | 'knowledge' }
  | { kind: 'assistant' | 'team' | 'template' | 'template-version' | 'knowledge'; id: string };
export type VisualSelection = { kind: 'inherit' } | { kind: 'asset'; assetId: string };
export interface VisualBinding {
  owner: VisualOwner;
  usage: VisualUsage;
  selection: VisualSelection;
  revision: number;
  effectiveAssetId: string | null;
}
export interface VisualBindingPatch {
  owner: VisualOwner;
  usage: VisualUsage;
  selection: VisualSelection;
  expectedRevision: number;
}
export type VisualBindingResult =
  | { kind: 'saved'; binding: VisualBinding }
  | { kind: 'failed'; owner: VisualOwner; code: string; message: string };

export const DEFAULT_VISUAL_ASSETS: Record<VisualUsage, string> = {
  avatar: 'avatar-general-v1', icon: 'subject-interdisciplinary-v1', cover: 'brand-pbl-v1', illustration: 'empty-explore-v1',
};
