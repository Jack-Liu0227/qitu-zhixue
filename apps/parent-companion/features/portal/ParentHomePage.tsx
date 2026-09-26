import Link from 'next/link';
import { childProfile, homeMetrics } from './data';
import { ProjectVisual } from './ProjectVisual';
import { StageTimeline } from './StageTimeline';

export function ParentHomePage() {
  return (
    <div className="parent-home-page">
      <section className="parent-context-strip" aria-label="孩子学习状态">
        <div>
          <span className="parent-live-dot" />
          <strong>{childProfile.name} 正在稳步推进项目</strong>
          <span>数据更新于 {childProfile.lastSynced}</span>
        </div>
        <Link href="/progress/projects">查看完整进展 <span aria-hidden="true">→</span></Link>
      </section>

      <section className="parent-metric-grid" aria-label="本周学习概览">
        {homeMetrics.map((metric) => (
          <article className="parent-metric-card" key={metric.label}>
            <span className={`parent-metric-icon is-${metric.tone}`} aria-hidden="true">{metric.icon}</span>
            <div>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.delta}</small>
            </div>
          </article>
        ))}
      </section>

      <div className="parent-dashboard-grid">
        <section className="parent-panel parent-project-card">
          <header className="parent-panel-header">
            <div>
              <span className="parent-kicker">当前项目 · 第 3 周 / 共 4 周</span>
              <h2>桌面 AI 陪伴机器人</h2>
              <p>把想法做成一个会感知、会回应的桌面伙伴</p>
            </div>
            <span className="parent-status-badge is-primary">实践制作中</span>
          </header>

          <div className="parent-project-hero">
            <ProjectVisual />
            <div className="parent-project-progress-copy">
              <div className="parent-progress-label"><span>整体进度</span><strong>62%</strong></div>
              <div className="parent-progress-track"><span style={{ width: '62%' }} /></div>
              <dl>
                <div><dt>本周目标</dt><dd>完成距离感应与灯光反馈</dd></div>
                <div><dt>最近学习</dt><dd>今天 19:12 · 36 分钟</dd></div>
              </dl>
            </div>
          </div>

          <StageTimeline />

          <div className="parent-current-task">
            <span className="parent-current-task-mark" aria-hidden="true">03</span>
            <div><small>当前任务</small><strong>让机器人根据距离改变灯光反馈</strong></div>
            <Link href="/progress/projects" aria-label="查看当前任务详情">→</Link>
          </div>
        </section>

        <aside className="parent-panel parent-perspective-card">
          <header className="parent-panel-header">
            <div><span className="parent-kicker">家长视角</span><h2>今天发生了什么</h2></div>
            <span className="parent-gentle-badge">可在晚饭时聊聊</span>
          </header>
          <div className="parent-insight-list">
            <article><span className="parent-insight-icon is-blue">做</span><div><small>孩子正在做</small><p>对比五次距离数据，寻找误触发的规律。</p></div></article>
            <article><span className="parent-insight-icon is-orange">卡</span><div><small>当前小卡点</small><p>传感器数值偶尔跳动，还没确定是环境还是程序原因。</p></div></article>
            <article><span className="parent-insight-icon is-teal">助</span><div><small>AI 已这样帮助</small><p>没有直接给答案，而是把问题缩小到一次只验证一个因素。</p></div></article>
          </div>
          <blockquote>
            <span>今晚可以问</span>
            “你今天发现了哪个原来没注意到的小线索？”
          </blockquote>
        </aside>
      </div>

      <div className="parent-lower-grid">
        <section className="parent-panel parent-growth-card">
          <header className="parent-panel-header">
            <div><span className="parent-kicker">成长观察</span><h2>值得看见的进步</h2></div>
            <Link href="/progress/records">全部记录</Link>
          </header>
          <div className="parent-growth-highlights">
            <article><span>01</span><div><strong>更会拆解问题</strong><p>先画流程，再逐个验证模块，不再同时修改所有地方。</p></div></article>
            <article><span>02</span><div><strong>愿意保留失败版本</strong><p>主动记录第一次测试的异常，为下一次调整留下依据。</p></div></article>
            <article><span>03</span><div><strong>表达更具体</strong><p>能说清楚“为什么这样改”，而不只描述做了什么。</p></div></article>
          </div>
          <div className="parent-celebrate-banner"><span aria-hidden="true">♡</span><p><strong>值得庆祝</strong> 小宇连续三次遇到问题都先记录现象，再决定怎么改。</p></div>
        </section>

        <section className="parent-panel parent-message-preview">
          <header className="parent-panel-header">
            <div><span className="parent-kicker">消息</span><h2>需要你的关注</h2></div>
            <Link href="/messages">查看全部</Link>
          </header>
          <Link className="parent-message-row is-unread" href="/messages">
            <span className="parent-message-dot" />
            <div><strong>传感器调试出现持续卡点</strong><p>AI 已调整解释方式，暂不需要直接介入。</p><small>今天 20:16</small></div>
            <span aria-hidden="true">→</span>
          </Link>
          <Link className="parent-message-row is-unread" href="/messages">
            <span className="parent-message-dot is-teal" />
            <div><strong>理论检查已完成</strong><p>实践阶段现已解锁。</p><small>昨天 18:40</small></div>
            <span aria-hidden="true">→</span>
          </Link>
        </section>
      </div>
    </div>
  );
}
