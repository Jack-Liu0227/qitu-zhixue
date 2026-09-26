import Link from 'next/link';
import {
  ActivityIcon,
  ArrowRightIcon,
  ChartIcon,
  HeartIcon,
  PhoneIcon,
  SparklesIcon,
  TrendingUpIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import { RadarChart } from '../../../components/radar-chart';

const interestRadar = [
  { label: '科学探究', value: 88 },
  { label: '逻辑推理', value: 74 },
  { label: '艺术表达', value: 63 },
  { label: '协作沟通', value: 70 },
  { label: '抗挫力', value: 59 },
];

const topGrowth = [
  { label: '林小宇 · 天文探究', value: 42 },
  { label: '赵可欣 · 编程创作', value: 38 },
  { label: '陈子墨 · 自然观察', value: 27 },
];

export default function StatisticsPage() {
  return (
    <div className="qtx-page">
      {/* 页面横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <ChartIcon size={28} />
              </div>
            </div>
            <div>
              <h2>数据统计</h2>
              <p>基于 learning_events 与 alerts 的实时班级洞察。</p>
            </div>
          </div>
          <div className="qtx-banner-slogan">数据不是标签，而是发现每个孩子闪光点的线索。</div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">🤖 本周主动探索率提升 4.2%，继续保持～</div>
            <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'linear-gradient(135deg,#38bdf8,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🤖</div>
          </div>
        </div>
      </section>

      {/* 指标卡 */}
      <section className="qtx-grid qtx-grid-4">
        <MetricCard label="累计伴学时长" value="3420h" delta={<>本月 <span className="up">+412h</span></>} icon={<ActivityIcon size={22} />} tone="#2563eb" />
        <MetricCard label="主动探索率" value="76.8%" delta={<>本周 <span className="up">+4.2%</span></>} icon={<SparklesIcon size={22} />} tone="#4f46e5" />
        <MetricCard label="卡顿协同解决率" value="84.2%" delta={<>目标 80% <span className="up">已达成</span></>} icon={<TrendingUpIcon size={22} />} tone="#0d9488" />
        <MetricCard label="家长端满意度" value="98%" delta={<>近 30 天稳定</>} icon={<HeartIcon size={22} />} tone="#e11d48" />
      </section>

      {/* 中部图表 */}
      <section className="qtx-grid qtx-grid-12">
        <div className="qtx-col-5 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#4f46e5' }} /> 兴趣雷达（班级均值）
            </div>
          </div>
          <RadarChart data={interestRadar} />
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {interestRadar.map((r) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
                <span>{r.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '55%' }}>
                  <div style={{ flex: 1, height: 6, background: '#eef2f7', borderRadius: 999 }}>
                    <div style={{ width: `${r.value}%`, height: 6, background: '#4f46e5', borderRadius: 999 }} />
                  </div>
                  <strong style={{ color: '#334155', width: 28, textAlign: 'right' }}>{r.value}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="qtx-col-7 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" /> 互动趋势
            </div>
            <select className="qtx-select" defaultValue="week">
              <option value="week">近 7 天</option>
              <option value="month">近 30 天</option>
            </select>
          </div>
          <svg viewBox="0 0 560 220" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <defs>
              <linearGradient id="statArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1="0" x2="560" y1={20 + i * 50} y2={20 + i * 50} stroke="#eef2f7" strokeWidth="1" />
            ))}
            <path d="M20,160 L100,130 L180,142 L260,92 L340,104 L420,60 L540,44 L540,180 L20,180 Z" fill="url(#statArea)" />
            <path d="M20,160 L100,130 L180,142 L260,92 L340,104 L420,60 L540,44" fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20,168 L100,146 L180,154 L260,122 L340,132 L420,96 L540,82" fill="none" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 6" />
            {[
              ['一', 20], ['二', 100], ['三', 180], ['四', 260], ['五', 340], ['六', 420], ['日', 540],
            ].map(([label, x]) => (
              <text key={label} x={x} y="205" fill="#94a3b8" fontSize="11" textAnchor="middle">{label}</text>
            ))}
          </svg>
          <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 12, color: '#64748b' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 3, background: '#2563eb', borderRadius: 2, display: 'inline-block' }} /> AI 导师互动
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 3, background: '#0d9488', borderRadius: 2, display: 'inline-block', opacity: 0.7 }} /> 人工干预
            </span>
          </div>
        </div>
      </section>

      {/* 底部：成长榜 + 家长反馈 */}
      <section className="qtx-grid qtx-grid-12">
        <div className="qtx-col-6 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#0d9488' }} /> 本周成长 TOP3
            </div>
            <Link className="qtx-link" href="/students">
              查看学生 <ArrowRightIcon size={14} />
            </Link>
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            {topGrowth.map((item, i) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: i === 0 ? '#fffbeb' : i === 1 ? '#f0f9ff' : '#ecfdf5',
                    color: i === 0 ? '#b45309' : i === 1 ? '#1d4ed8' : '#047857',
                    fontWeight: 800, fontSize: 14,
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                    <strong style={{ color: '#1e293b' }}>{item.label}</strong>
                    <span style={{ color: '#64748b' }}>成长值 {item.value}</span>
                  </div>
                  <div style={{ height: 8, background: '#eef2f7', borderRadius: 999 }}>
                    <div style={{ width: `${(item.value / 42) * 100}%`, height: 8, borderRadius: 999, background: i === 0 ? '#d97706' : i === 1 ? '#2563eb' : '#059669' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="qtx-col-6 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#e11d48' }} /> 家长端协同反馈看板
            </div>
            <PhoneIcon size={18} style={{ color: '#94a3b8' }} />
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              ['赵可欣家长', '本周项目节点说明很清晰，希望继续保持。', '2 小时前', 'qtx-badge-emerald', '已解决'],
              ['王一诺家长', '希望增加语音任务进度播报。', '昨天', 'qtx-badge-blue', '跟进中'],
              ['陈子墨家长', '成长档案照片能否支持批量下载？', '3 天前', 'qtx-badge-amber', '待评估'],
            ].map(([who, msg, time, tone, status]) => (
              <div key={String(msg)} style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f7' }}>
                <span style={{ width: 36, height: 36, borderRadius: 11, background: '#fff', border: '1px solid #eef2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👨‍👩‍👧</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13, color: '#1e293b' }}>{who}</strong>
                    <span className={`qtx-badge ${tone}`}>{status}</span>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{msg}</p>
                  <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>{time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
