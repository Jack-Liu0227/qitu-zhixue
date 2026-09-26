'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { growthRecords, projectWorks } from './data';
import { ProjectVisual } from './ProjectVisual';
import { StageTimeline } from './StageTimeline';

type ProgressView = 'projects' | 'records' | 'works';

function resolveView(pathname: string): ProgressView {
  if (pathname.endsWith('/records')) return 'records';
  if (pathname.endsWith('/works')) return 'works';
  return 'projects';
}

export function ParentProgressPage() {
  const pathname = usePathname();
  const view = resolveView(pathname);
  const [recordSource, setRecordSource] = useState('全部来源');
  const [workType, setWorkType] = useState('全部类型');

  const visibleRecords = useMemo(
    () => growthRecords.filter((record) => recordSource === '全部来源' || record.source === recordSource),
    [recordSource],
  );
  const visibleWorks = useMemo(
    () => projectWorks.filter((work) => workType === '全部类型' || work.type === workType),
    [workType],
  );

  return (
    <div className="parent-progress-page">
      <nav className="parent-view-tabs" aria-label="学习进展视图">
        <Link className={view === 'projects' ? 'is-active' : undefined} href="/progress/projects">项目进度</Link>
        <Link className={view === 'records' ? 'is-active' : undefined} href="/progress/records">成长记录</Link>
        <Link className={view === 'works' ? 'is-active' : undefined} href="/progress/works">作品成果</Link>
      </nav>

      {view === 'projects' ? (
        <div className="parent-progress-projects">
          <section className="parent-panel parent-progress-overview">
            <div className="parent-progress-project-title">
              <ProjectVisual compact />
              <div><span className="parent-status-badge is-primary">进行中</span><h2>桌面 AI 陪伴机器人</h2><p>四周路线 · 第 3 周 · 实践制作阶段</p></div>
              <div className="parent-progress-ring" aria-label="项目完成 62%"><strong>62%</strong><span>整体进度</span></div>
            </div>
            <StageTimeline detailed />
          </section>

          <div className="parent-progress-columns">
            <section className="parent-panel parent-task-detail">
              <header className="parent-panel-header"><div><span className="parent-kicker">当前任务</span><h2>距离感应与灯光反馈</h2></div><span className="parent-status-badge is-attention">需要调试</span></header>
              <p className="parent-task-intro">小宇正在让机器人根据距离变化给出不同颜色的灯光反馈。理论门槛已通过，本任务可以继续实践。</p>
              <div className="parent-checklist">
                <div className="is-done"><span>✓</span><p><strong>完成基础连接</strong><small>已保存过程照片</small></p></div>
                <div className="is-done"><span>✓</span><p><strong>读取五组距离数据</strong><small>已记录测试结果</small></p></div>
                <div className="is-current"><span>3</span><p><strong>定位数据跳动原因</strong><small>正在对比环境因素与程序逻辑</small></p></div>
                <div><span>4</span><p><strong>完成灯光反馈</strong><small>等待当前步骤完成</small></p></div>
              </div>
            </section>

            <aside className="parent-panel parent-evidence-card">
              <header className="parent-panel-header"><div><span className="parent-kicker">过程证据</span><h2>为什么显示这项进步</h2></div></header>
              <div className="parent-evidence-score"><span>问题分解</span><strong>持续出现</strong></div>
              <p>结论来自三条可追溯记录，不由学习时长或聊天次数推断。</p>
              <ul><li>自主画出功能流程图</li><li>把异常拆成环境与程序两类</li><li>说明了下一次验证顺序</li></ul>
              <div className="parent-evidence-meta"><span>最近更新</span><strong>今天 20:42</strong></div>
            </aside>
          </div>
        </div>
      ) : null}

      {view === 'records' ? (
        <section className="parent-panel parent-records-panel">
          <header className="parent-filter-header">
            <div><span className="parent-kicker">过程性记录</span><h2>成长不是一个分数</h2><p>每条观察都可以回到具体任务、作品或孩子的表达。</p></div>
            <label><span>记录来源</span><select value={recordSource} onChange={(event) => setRecordSource(event.target.value)}><option>全部来源</option><option>AI 导师记录</option><option>孩子自述</option><option>家长反馈</option></select></label>
          </header>
          <div className="parent-record-timeline">
            {visibleRecords.map((record) => (
              <article key={record.title}>
                <time>{record.date}</time>
                <span className={`parent-record-node is-${record.tone}`} />
                <div><small>{record.source}</small><h3>{record.title}</h3><p>{record.summary}</p><div>{record.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view === 'works' ? (
        <section className="parent-works-section">
          <header className="parent-filter-header parent-panel">
            <div><span className="parent-kicker">已授权给家长查看</span><h2>作品与过程版本</h2><p>展示作品不会覆盖学习过程，历史版本会一直保留。</p></div>
            <label><span>作品类型</span><select value={workType} onChange={(event) => setWorkType(event.target.value)}><option>全部类型</option><option>交互原型</option><option>学习记录</option><option>测试记录</option></select></label>
          </header>
          <div className="parent-work-grid">
            {visibleWorks.map((work, index) => (
              <article className="parent-panel parent-work-card" key={work.title}>
                <div className={`parent-work-cover is-${work.accent}`}>{index === 0 ? <ProjectVisual compact /> : <span aria-hidden="true">{index === 1 ? '流程' : '测试'}</span>}</div>
                <div className="parent-work-copy"><div><span className="parent-status-badge">{work.type}</span><time>{work.date}</time></div><h3>{work.title}</h3><p>{work.description}</p><footer><span>{work.stage}</span><button type="button">查看详情 <span aria-hidden="true">→</span></button></footer></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
