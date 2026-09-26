import Link from 'next/link';
import {
  ActivityIcon,
  AlertIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  FileDownIcon,
  HeartIcon,
  SparklesIcon,
  UsersIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import { issues, students } from '../../../lib/mock-data';

export default function DashboardPage() {
  return (
    <div className="qtx-page">
      {/* 欢迎横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <SparklesIcon size={28} />
              </div>
            </div>
            <div>
              <h2>早上好，陈老师！</h2>
              <p>今天有 12 个待处理问题，其中 3 个需要重点关注。</p>
            </div>
          </div>
          <div className="qtx-banner-slogan">
            保持好奇心的探索，
            <br />
            比给出标准答案更重要。
          </div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">🤖 已为你整理今日待办，先处理 3 个情绪预警吧～</div>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: '50%',
                background: 'linear-gradient(135deg,#38bdf8,#6366f1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                boxShadow: '0 8px 20px rgba(99,102,241,.28)',
              }}
            >
              🤖
            </div>
          </div>
        </div>
      </section>

      {/* 指标卡 */}
      <section className="qtx-grid qtx-grid-4">
        <MetricCard
          label="学生总数"
          value="128"
          delta={<>较上月 <span className="up">+12</span></>}
          icon={<UsersIcon size={22} />}
          tone="#2563eb"
        />
        <MetricCard
          label="进行中的项目"
          value="86"
          delta={<>较上月 <span className="up">+8</span></>}
          icon={<ActivityIcon size={22} />}
          tone="#4f46e5"
        />
        <MetricCard
          label="待处理问题"
          value="12"
          delta={<>较昨日 <span className="down">-5</span></>}
          icon={<AlertIcon size={22} />}
          tone="#d97706"
        />
        <MetricCard
          label="今日已解决"
          value="28"
          delta={<>解决率 <span className="up">70%</span></>}
          icon={<CheckCircleIcon size={22} />}
          tone="#059669"
        />
      </section>

      {/* 中部：图表 + 待办 */}
      <section className="qtx-grid qtx-grid-12">
        <div className="qtx-col-8 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" /> 本周学习活跃趋势
            </div>
            <button className="qtx-btn qtx-btn-ghost-blue" type="button">
              导出周报
              <FileDownIcon size={15} />
            </button>
          </div>
          <div className="qtx-grid qtx-grid-12" style={{ gap: 18 }}>
            <div className="qtx-col-8">
              <svg viewBox="0 0 560 200" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3].map((i) => (
                  <line key={i} x1="0" x2="560" y1={20 + i * 45} y2={20 + i * 45} stroke="#eef2f7" strokeWidth="1" />
                ))}
                <path
                  d="M20,150 L100,120 L180,132 L260,86 L340,96 L420,54 L540,38 L540,160 L20,160 Z"
                  fill="url(#dashArea)"
                />
                <path
                  d="M20,150 L100,120 L180,132 L260,86 L340,96 L420,54 L540,38"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M20,158 L100,140 L180,146 L260,116 L340,122 L420,88 L540,72"
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="6 6"
                />
                {[
                  ['一', 20], ['二', 100], ['三', 180], ['四', 260], ['五', 340], ['六', 420], ['日', 540],
                ].map(([label, x]) => (
                  <text key={label} x={x} y="185" fill="#94a3b8" fontSize="11" textAnchor="middle">
                    {label}
                  </text>
                ))}
              </svg>
              <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 12, color: '#64748b' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 3, background: '#2563eb', borderRadius: 2, display: 'inline-block' }} />
                  活跃学生
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 3, background: '#4f46e5', borderRadius: 2, display: 'inline-block', opacity: 0.7 }} />
                  完成任务
                </span>
              </div>
            </div>
            <div className="qtx-col-4">
              <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 12 }}>项目阶段分布</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                <svg viewBox="0 0 120 120" style={{ width: 150, height: 150 }}>
                  <circle cx="60" cy="60" r="46" fill="none" stroke="#eef2f7" strokeWidth="16" />
                  {[
                    ['#2563eb', 0, 0.38],
                    ['#4f46e5', 0.38, 0.62],
                    ['#0d9488', 0.62, 0.84],
                    ['#d97706', 0.84, 1],
                  ].map(([color, from, to]) => {
                    const start = Number(from) * 100;
                    const len = (Number(to) - Number(from)) * 100;
                    return (
                      <circle
                        key={String(color)}
                        cx="60"
                        cy="60"
                        r="46"
                        fill="none"
                        stroke={String(color)}
                        strokeWidth="16"
                        strokeDasharray={`${len} ${100 - len}`}
                        strokeDashoffset={-start}
                        transform="rotate(-90 60 60)"
                        strokeLinecap="butt"
                      />
                    );
                  })}
                </svg>
                <div style={{ position: 'absolute', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>86</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>进行中</div>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {[
                  ['灵感探索', 33, '#2563eb'],
                  ['深度研究', 21, '#4f46e5'],
                  ['制作测试', 19, '#0d9488'],
                  ['成果展示', 13, '#d97706'],
                ].map(([label, count, color]) => (
                  <div key={String(label)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: String(color), display: 'inline-block' }} />
                      {label}
                    </span>
                    <strong style={{ color: '#334155' }}>{count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="qtx-col-4 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#d97706' }} /> 待处理问题
            </div>
            <Link className="qtx-link" href="/issues">
              查看全部 <ArrowRightIcon size={14} />
            </Link>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {issues.slice(0, 3).map((issue) => (
              <div key={issue.id} style={{ display: 'flex', gap: 10, padding: 10, borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f7' }}>
                <span
                  style={{
                    width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: issue.level === 'L1' ? '#fff1f2' : issue.level === 'L2' ? '#fffbeb' : '#eff6ff',
                    color: issue.level === 'L1' ? '#be123c' : issue.level === 'L2' ? '#b45309' : '#1d4ed8',
                  }}
                >
                  <AlertIcon size={17} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13, color: '#1e293b' }}>{issue.studentName}</strong>
                    <span className={`qtx-badge ${issue.level === 'L1' ? 'qtx-badge-rose' : issue.level === 'L2' ? 'qtx-badge-amber' : 'qtx-badge-blue'}`}>{issue.category}</span>
                  </div>
                  <p style={{ margin: '5px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{issue.summary}</p>
                  <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', display: 'flex', gap: 10 }}>
                    <span><ClockIcon size={12} /> {issue.time}</span>
                    <span>{issue.channel}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 底部：最近活跃学生 + 快捷操作 */}
      <section className="qtx-grid qtx-grid-12">
        <div className="qtx-col-7 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#4f46e5' }} /> 最近活跃学生
            </div>
            <Link className="qtx-link" href="/students">
              学生管理 <ArrowRightIcon size={14} />
            </Link>
          </div>
          <div className="qtx-table-wrap">
            <table className="qtx-table">
              <thead>
                <tr>
                  <th>学生</th>
                  <th>当前项目</th>
                  <th>活跃天数</th>
                  <th>专注度</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {students.slice(0, 4).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="qtx-avatar" style={{ width: 32, height: 32, borderRadius: 10, fontSize: 13 }}>{s.avatar}</span>
                        <div>
                          <strong style={{ color: '#1e293b' }}>{s.name}</strong>
                          <div className="qtx-small qtx-muted">{s.grade}</div>
                        </div>
                      </div>
                    </td>
                    <td>{s.projectStage}</td>
                    <td>{s.activeDays} 天</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 70, height: 6, background: '#eef2f7', borderRadius: 999 }}>
                          <div style={{ width: `${s.focusScore}%`, height: 6, background: s.focusScore >= 80 ? '#059669' : '#d97706', borderRadius: 999 }} />
                        </div>
                        <span>{s.focusScore}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`qtx-badge ${s.status === '在线' ? 'qtx-badge-emerald' : 'qtx-badge-slate'}`}>
                        <span className="qtx-status-dot" style={{ background: s.status === '在线' ? '#059669' : '#94a3b8' }} />
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="qtx-col-5 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#059669' }} /> 快捷操作
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['📋', '发布本周任务', '向全班推送项目任务'],
              ['🧑‍🏫', '分配导师', '调整学生导师关系'],
              ['💬', '回复家长诉求', '处理家长端反馈'],
              ['📊', '生成本周报告', '导出班级学习周报'],
            ].map(([emoji, title, desc]) => (
              <button
                key={title}
                type="button"
                style={{
                  display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start',
                  padding: 14, borderRadius: 14, border: '1px solid #eef2f7', background: '#fff',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  transition: 'all .15s ease',
                }}
              >
                <span style={{ fontSize: 22 }}>{emoji}</span>
                <strong style={{ fontSize: 13, color: '#1e293b' }}>{title}</strong>
                <span style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{desc}</span>
              </button>
            ))}
          </div>
          <div
            style={{
              marginTop: 14, padding: 12, borderRadius: 12, background: '#f0f9ff',
              border: '1px solid #dbeafe', fontSize: 12, color: '#1d4ed8', lineHeight: 1.6,
              display: 'flex', gap: 8, alignItems: 'flex-start',
            }}
          >
            <HeartIcon size={15} style={{ marginTop: 2, flexShrink: 0 }} />
            今日已有 42 名学生保持连续探索，家长端满意度维持在 98%。
          </div>
        </div>
      </section>
    </div>
  );
}
