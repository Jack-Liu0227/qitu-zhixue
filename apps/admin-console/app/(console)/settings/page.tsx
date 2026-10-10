import Link from 'next/link';

export default function SettingsIndexPage() {
  const areas = [
    { href: '/settings/model-providers', icon: '◈', title: '模型供应商', description: '管理 NewAPI / OpenAI-compatible 网关、密钥和模型目录。', accent: 'blue' },
    { href: '/settings/assistants', icon: '◆', title: 'AI 助手', description: '配置服务端 Agent 的职责、模型和能力。', accent: 'violet' },
    { href: '/settings/teams', icon: '⊞', title: '团队设置', description: '查看协作节点、路由和真实 Team Run。', accent: 'teal' },
    { href: '/settings/ai-runtime', icon: '⌁', title: 'AI 运行时', description: '检查 Skills、工具、MCP 和初始化状态。', accent: 'amber' },
    { href: '/settings/knowledge', icon: '▤', title: '知识库', description: '维护可供运行时检索的知识来源。', accent: 'slate' },
    { href: '/settings/templates', icon: '▦', title: '模板库', description: '管理项目、任务与对话的可复用模板。', accent: 'rose' },
  ];

  return (
    <div className="settings-overview-page">
      <header className="settings-pagehead">
        <div className="settings-titlebox">
          <span className="settings-eyebrow">WORKSPACE SETTINGS</span>
          <h1>设置总览</h1>
          <p className="settings-desc">集中管理启途智学的模型接入、AI 助手、团队协作和运行时资源。</p>
        </div>
      </header>
      <section className="settings-overview-intro">
        <div><span className="settings-overview-kicker">控制面板</span><h2>把每个运行时依赖放在同一条路径上</h2><p>先配置模型供应商，再将可用模型绑定给助手和团队。服务端会在每次执行前重新校验权限与配置状态。</p></div>
        <Link href="/settings/model-providers" className="settings-action-btn is-primary">管理模型供应商 <span aria-hidden="true">→</span></Link>
      </section>
      <div className="settings-overview-grid">
        {areas.map((area) => <Link key={area.href} href={area.href} className={`settings-overview-card is-${area.accent}`}><span className="settings-overview-icon" aria-hidden="true">{area.icon}</span><span className="settings-overview-copy"><strong>{area.title}</strong><span>{area.description}</span></span><span className="settings-overview-arrow" aria-hidden="true">→</span></Link>)}
      </div>
    </div>
  );
}
