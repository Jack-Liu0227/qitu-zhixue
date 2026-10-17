import { Injectable } from '@nestjs/common';
import type { AdminSettingsRegistry, AdminSettingsRegistryItem } from '@qitu/contracts';

/**
 * 设置页路由清单。总览自身也是一个设置路由，因此完整清单应有 20 项：
 * 19 个设置目录 + `/settings` 总览。
 */
export const ADMIN_SETTINGS_ROUTE_MANIFEST = [
  'about',
  'account',
  'ai-runtime',
  'appearance',
  'assistants',
  'database',
  'dialogs',
  'feishu',
  'knowledge',
  'model-providers',
  'models',
  'ops',
  'plugins',
  'profile-growth',
  'skills',
  'system',
  'teams',
  'templates',
  'tools',
  'overview',
] as const;

const REGISTRY: AdminSettingsRegistry = [
  {
    id: 'overview', href: '/settings', group: '工作区', icon: '⌂', title: '系统设置总览', label: '设置总览',
    description: '集中查看平台所有设置域及其当前状态。', accent: 'slate', badgeKind: 'static', order: 0,
  },
  {
    id: 'account', href: '/settings/account', group: '工作区', icon: '👤', title: '账号设置', label: '账号设置',
    description: '管理管理员账号资料与登录安全偏好。', accent: 'blue', badgeKind: 'static', order: 10,
  },
  {
    id: 'ai-runtime', href: '/settings/ai-runtime', group: 'AI 核心架构', icon: '⌘', title: 'AI 运行时', label: 'AI 运行时',
    description: '查看 AI 运行时治理入口及助手、模型、技能和工具的拆分配置。', accent: 'violet', badgeKind: 'static', order: 10,
  },
  {
    id: 'assistants', href: '/settings/assistants', group: 'AI 核心架构', icon: '🤖', title: 'AI 助手', label: 'AI 助手',
    description: '配置自建 Agent SDK 导师智能体的职责、大模型与发问约束。', accent: 'violet', badgeKind: 'assistant-count', order: 20,
  },
  {
    id: 'feishu', href: '/settings/feishu', group: 'AI 核心架构', icon: '🪽', title: '飞书机器人', label: '飞书机器人',
    description: '管理管理员汇报助手的 Feishu/Lark 连接与汇报范围。', accent: 'teal', badgeKind: 'static', order: 30,
  },
  {
    id: 'teams', href: '/settings/teams', group: 'AI 核心架构', icon: '👥', title: '协作团队', label: '协作团队',
    description: '管理多智能体 PBL 导师团队及其协同配置。', accent: 'teal', badgeKind: 'team-count', order: 40,
  },
  {
    id: 'model-providers', href: '/settings/model-providers', group: 'AI 核心架构', icon: '◈', title: '模型接入与通道', label: '模型接入',
    description: '管理供应商网关、凭证、通道与模型目录。', accent: 'blue', badgeKind: 'static', order: 50,
  },
  {
    id: 'models', href: '/settings/models', group: 'AI 核心架构', icon: '◉', title: '模型兼容入口', label: '旧模型入口',
    description: '保留旧书签兼容，模型目录统一在模型接入与通道中维护。', accent: 'blue', badgeKind: 'static', order: 60,
  },
  {
    id: 'skills', href: '/settings/skills', group: 'AI 核心架构', icon: 'ϟ', title: '技能中心', label: '技能中心',
    description: '配置遵循 Prompt 与工程约定的能力包，并绑定至指定助手。', accent: 'amber', badgeKind: 'runtime-skills', order: 70,
  },
  {
    id: 'tools', href: '/settings/tools', group: 'AI 核心架构', icon: '🧰', title: '工具与 MCP', label: '工具与 MCP',
    description: '管理知识库调用开关、智能体授权与已注册工具状态。', accent: 'emerald', badgeKind: 'runtime-tools', order: 80,
  },
  {
    id: 'plugins', href: '/settings/plugins', group: 'AI 核心架构', icon: '🧩', title: '生态插件 (Plugins)', label: '生态插件',
    description: '通过标准扩展钩子注册评估门禁、沙箱工具与工作台画板。', accent: 'indigo', badgeKind: 'static', order: 90,
  },
  {
    id: 'knowledge', href: '/settings/knowledge', group: '内容与数据', icon: '▤', title: '知识中心', label: '知识中心',
    description: '管理资料、项目知识库、索引任务与知识引擎。', accent: 'slate', badgeKind: 'static', order: 10,
  },
  {
    id: 'templates', href: '/settings/templates', group: '内容与数据', icon: '▦', title: '项目模板库', label: '项目模板库',
    description: '维护 PBL 四阶段教学流程设计与阶段提示词。', accent: 'rose', badgeKind: 'static', order: 20,
  },
  {
    id: 'profile-growth', href: '/settings/profile-growth', group: '内容与数据', icon: '📊', title: '学情画像与成长轨迹', label: '学情画像与轨迹',
    description: '配置学生能力画像、PBL 事件流与隐私隔离策略。', accent: 'emerald', badgeKind: 'static', order: 30,
  },
  {
    id: 'database', href: '/settings/database', group: '内容与数据', icon: '◫', title: '数据库管理', label: '数据库',
    description: '查看 PostgreSQL 关系模型、数据表记录数与审计日志。', accent: 'gray', badgeKind: 'static', order: 40,
  },
  {
    id: 'dialogs', href: '/settings/dialogs', group: '应用与会话', icon: '💬', title: '已安装的对话', label: '已安装的对话',
    description: '管理标准化引导剧本，接通底座 Agent SDK 并支持实测演练。', accent: 'cyan', badgeKind: 'static', order: 10,
  },
  {
    id: 'appearance', href: '/settings/appearance', group: '应用与会话', icon: '◐', title: '外观偏好', label: '外观偏好',
    description: '管理管理端的显示与主题偏好。', accent: 'indigo', badgeKind: 'static', order: 20,
  },
  {
    id: 'ops', href: '/settings/ops', group: '应用与会话', icon: '🌐', title: '沉浸运维', label: '沉浸运维',
    description: '查看沉浸式应用运行状态与运维入口。', accent: 'teal', badgeKind: 'static', order: 30,
  },
  {
    id: 'system', href: '/settings/system', group: '应用与会话', icon: '⚙️', title: '系统设置', label: '系统设置',
    description: '管理平台级系统行为与安全策略入口。', accent: 'gray', badgeKind: 'static', order: 40,
  },
  {
    id: 'about', href: '/settings/about', group: '应用与会话', icon: 'ⓘ', title: '关于启途', label: '关于启途',
    description: '查看启途智学版本、构建与产品信息。', accent: 'slate', badgeKind: 'static', order: 50,
  },
];

export function assertSettingsRegistryCoverage(
  registry: readonly AdminSettingsRegistryItem[] = REGISTRY,
): void {
  const expected = new Set<string>(ADMIN_SETTINGS_ROUTE_MANIFEST);
  const actual = new Set(registry.map((item) => item.id));
  const missing = [...expected].filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.has(id));
  const expectedHrefs = new Set([...expected].map((id) => id === 'overview' ? '/settings' : `/settings/${id}`));
  const actualHrefs = new Set(registry.map((item) => item.href));
  const missingHrefs = [...expectedHrefs].filter((href) => !actualHrefs.has(href));
  const unexpectedHrefs = [...actualHrefs].filter((href) => !expectedHrefs.has(href));
  if (missing.length > 0 || unexpected.length > 0 || missingHrefs.length > 0 || unexpectedHrefs.length > 0 || actual.size !== registry.length || actualHrefs.size !== registry.length) {
    throw new Error(
      `设置注册表与路由清单不一致：缺少 [${missing.join(', ')}]，多出 [${unexpected.join(', ')}]，缺少路由 [${missingHrefs.join(', ')}]，多出路由 [${unexpectedHrefs.join(', ')}]，存在重复项=${registry.length !== actual.size || registry.length !== actualHrefs.size}`,
    );
  }
}

assertSettingsRegistryCoverage();

@Injectable()
export class SettingsRegistryService {
  list(): AdminSettingsRegistry {
    return REGISTRY.map((item) => ({ ...item }));
  }
}

export const SETTINGS_REGISTRY = REGISTRY;
