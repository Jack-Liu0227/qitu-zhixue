import type { PublicTemplateRecord } from './public-content.types';

/**
 * `demo` / `test` 数据模式下的首页展厅种子。
 *
 * 取值与远程 `qitu_dev` 中真实发布的平台模板一致（`python-mini-project` /
 * `story-game`），这样演示环境与 live 环境的首页结构相同，避免「演示能看、
 * 正式是空白」这类只有上线才发现的差异。
 *
 * 计数刻意留空（默认 0）：内存模式没有用户 / 学校 / 作品表，编造数字比展示 0 更糟。
 */
export const DEMO_FEATURED_TEMPLATES: PublicTemplateRecord[] = [
  {
    id: 'template-python-mini-project',
    slug: 'python-mini-project',
    title: 'Python 小项目：从兴趣到作品',
    summary: '用一个真实小需求串起变量、分支、循环与调试，最终交付可运行的小程序。',
    domain: 'programming',
    ageRange: '10-14',
    difficulty: 'beginner',
    estimatedDurationMinutes: 480,
    outcomeForm: '可运行代码 + 演示说明',
    learningObjectives: [
      '能用变量与分支表达一个真实需求的规则',
      '能独立定位并修复至少一个运行错误',
      '能向同伴讲清楚自己的实现思路',
    ],
    stages: [
      { id: 'exploration', label: '探索' },
      { id: 'theory', label: '理论' },
      { id: 'practice', label: '实践' },
      { id: 'reflection', label: '反思' },
    ],
    version: 'v1',
    publishedAt: new Date('2026-09-29T07:16:30.980Z'),
    participants: 0,
  },
  {
    id: 'template-story-game',
    slug: 'story-game',
    title: '故事游戏创作模板',
    summary: '从角色与冲突出发设计一段可玩的分支剧情，用文字与规则搭建自己的故事游戏。',
    domain: 'design',
    ageRange: '9-13',
    difficulty: 'beginner',
    estimatedDurationMinutes: 360,
    outcomeForm: '故事脚本 + 分支剧情图',
    learningObjectives: [
      '能设计有动机的角色与冲突',
      '能用分支结构组织多结局剧情',
      '能根据同伴试玩反馈迭代一版内容',
    ],
    stages: [
      { id: 'exploration', label: '探索' },
      { id: 'theory', label: '理论' },
      { id: 'practice', label: '实践' },
      { id: 'reflection', label: '反思' },
    ],
    version: 'v1',
    publishedAt: new Date('2026-09-29T07:16:30.980Z'),
    participants: 0,
  },
];
