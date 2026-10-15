'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchAdminAssistantConfigs } from '../../../lib/api/assistants';
import { fetchAdminTeamConfigs } from '../../../lib/api/teams';

export default function SettingsIndexPage() {
  const [assistantsCount, setAssistantsCount] = useState<number>(9);
  const [teamsCount, setTeamsCount] = useState<number>(2);
  const [toolsCount, setToolsCount] = useState<number>(5);
  const [skillsCount, setSkillsCount] = useState<number>(3);
  const [templatesCount, setTemplatesCount] = useState<number>(4);

  useEffect(() => {
    fetchAdminAssistantConfigs()
      .then((res) => {
        if (res && res.length > 0) setAssistantsCount(res.length);
      })
      .catch(() => {});

    fetchAdminTeamConfigs()
      .then((res) => {
        if (res && res.length > 0) setTeamsCount(res.length);
      })
      .catch(() => {});

    if (typeof window !== 'undefined') {
      try {
        const mcps = localStorage.getItem('qitu.admin.mcp_list');
        if (mcps) {
          const list = JSON.parse(mcps);
          if (Array.isArray(list)) setToolsCount(list.length + 2); // 加上 2 个原生内置工具
        }
        const sks = localStorage.getItem('qitu.admin.skills_list');
        if (sks) {
          const slist = JSON.parse(sks);
          if (Array.isArray(slist)) setSkillsCount(slist.length);
        }
      } catch {}
    }
  }, []);

  const areas = [
    { href: '/settings/assistants', icon: '🤖', title: 'AI 助手', badge: `${assistantsCount} 个助手已就绪`, description: '配置自建 Agent SDK 导师智能体的职责、大模型与发问约束。', accent: 'violet' },
    { href: '/settings/teams', icon: '👥', title: '协作团队', badge: `${teamsCount} 支导师战队`, description: '管理多智能体 PBL 导师团队（雷霆战机团队与动能定理团队）。', accent: 'teal' },
    { href: '/settings/model-providers', icon: '◈', title: '模型接入与通道', badge: '多通道网关', description: '管理 OpenAI-compatible / NewAPI 网关、密钥、通道与模型目录。', accent: 'blue' },
    { href: '/settings/skills', icon: 'ϟ', title: '技能中心', badge: `${skillsCount} 个能力包`, description: '配置遵循 Prompt 与工程约定的能力包，并绑定至指定助手。', accent: 'amber' },
    { href: '/settings/tools', icon: '🧰', title: '工具与 MCP', badge: `${toolsCount} 个工具与原生沙箱`, description: '管理 Model Context Protocol 服务器（Chrome DevTools、Grok）与代码沙箱。', accent: 'emerald' },
    { href: '/settings/plugins', icon: '🧩', title: '生态插件 (Plugins)', badge: '4 类标准扩展', description: '通过 4 类标准扩展钩子注册评估门禁、沙箱工具与工作台画板。', accent: 'indigo' },
    { href: '/settings/knowledge', icon: '▤', title: '教学知识库', badge: '启途知识切片', description: '基于启途核心架构管理概念库、事实切片分块与导师检索挂载。', accent: 'slate' },
    { href: '/settings/templates', icon: '▦', title: '项目模板库', badge: `${templatesCount} 个 PBL 模板`, description: '维护 PBL 四阶段教学流程设计、TheoryMastered 门禁与阶段提示词。', accent: 'rose' },
    { href: '/settings/profile-growth', icon: '📊', title: '学情画像与成长轨迹', badge: '隐私双向隔离', description: '配置学生个人能力画像多维权重、PBL 事件流自动捕获及隐私隔离策略。', accent: 'emerald' },
    { href: '/settings/dialogs', icon: '💬', title: '已安装的对话', badge: '剧本沙盒', description: '管理标准化引导剧本，接通底座 Agent SDK 并支持实测演练。', accent: 'cyan' },
    { href: '/settings/database', icon: '◫', title: '数据库管理', badge: 'PostgreSQL 实时', description: '查看 PostgreSQL 关系模型、数据表记录数与审计日志。', accent: 'gray' },
  ];

  return (
    <div className="settings-overview-page">
      <header className="settings-pagehead">
        <div className="settings-titlebox">
          <span className="settings-eyebrow">WORKSPACE SETTINGS</span>
          <h1>系统设置总览</h1>
          <div className="settings-desc">
            集中管理启途智学平台的大模型接入、AI 助手、协作团队、技能、工具与生态插件。
          </div>
        </div>
      </header>

      <section className="settings-overview-intro">
        <div>
          <span className="settings-overview-kicker">全栈协同</span>
          <h2>将智能体、团队协作与项目模板深度咬合</h2>
          <p>
            底层依托自主研发 Agent SDK，连接模型、助手、技能与沙箱工具。由项目模板驱动 PBL 四阶段门禁管控，全链路真实协同。
          </p>
        </div>
        <Link href="/settings/teams" className="settings-action-btn is-primary">
          查看团队配置 <span aria-hidden="true">→</span>
        </Link>
      </section>

      <div className="settings-overview-grid">
        {areas.map((area) => (
          <Link
            key={area.href}
            href={area.href}
            className={`settings-overview-card is-${area.accent}`}
          >
            <span className="settings-overview-icon" aria-hidden="true">
              {area.icon}
            </span>
            <span className="settings-overview-copy">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <strong>{area.title}</strong>
                {area.badge ? (
                  <span style={{ fontSize: '11px', background: 'rgba(37,99,235,0.08)', color: '#2563eb', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    {area.badge}
                  </span>
                ) : null}
              </div>
              <span style={{ marginTop: '4px' }}>{area.description}</span>
            </span>
            <span className="settings-overview-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
