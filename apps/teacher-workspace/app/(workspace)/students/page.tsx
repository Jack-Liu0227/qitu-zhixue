'use client';

import { useState } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileDownIcon,
  SearchIcon,
  SlidersIcon,
  SparklesIcon,
  UsersIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import { RadarChart } from '../../../components/radar-chart';
import { students } from '../../../lib/mock-data';

export default function StudentsPage() {
  const [selectedId, setSelectedId] = useState(students[0]!.id);
  const selected = students.find((s) => s.id === selectedId) ?? students[0]!;
  const [tab, setTab] = useState<'profile' | 'tasks' | 'archive'>('profile');

  return (
    <div className="qtx-page">
      {/* 页面横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <UsersIcon size={28} />
              </div>
            </div>
            <div>
              <h2>学生管理</h2>
              <p>128 名学生 · 覆盖 4 个年级 · 今日画像更新 96 人</p>
            </div>
          </div>
          <div className="qtx-banner-slogan">每个孩子的兴趣主线，都值得被持续看见。</div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">🤖 已为你生成 8 份待同步家长周报，记得查收～</div>
            <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'linear-gradient(135deg,#38bdf8,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🤖</div>
          </div>
        </div>
      </section>

      {/* 指标卡 */}
      <section className="qtx-grid qtx-grid-4">
        <MetricCard label="学生总数" value="128" delta={<>较上月 <span className="up">+12</span></>} icon={<UsersIcon size={22} />} tone="#2563eb" />
        <MetricCard label="成长兴趣主线" value="42" delta={<>本周 <span className="up">+6</span> 条</>} icon={<SparklesIcon size={22} />} tone="#4f46e5" />
        <MetricCard label="今日画像更新" value="96" delta={<>覆盖率 <span className="up">75%</span></>} icon={<SlidersIcon size={22} />} tone="#0d9488" />
        <MetricCard label="待同步家长周报" value="8" delta={<>建议今日内完成</>} icon={<FileDownIcon size={22} />} tone="#d97706" />
      </section>

      {/* 主体：列表 + 详情 */}
      <section className="qtx-grid qtx-grid-12" style={{ alignItems: 'flex-start' }}>
        <div className="qtx-col-7 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" /> 学生列表
            </div>
            <button className="qtx-btn qtx-btn-primary" type="button">+ 邀请学生</button>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <SearchIcon size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input className="qtx-input" style={{ paddingLeft: 36 }} placeholder="搜索学生姓名或 ID" />
            </div>
            <select className="qtx-select" defaultValue="">
              <option value="">全部年级</option>
              <option>四年级</option>
              <option>五年级</option>
              <option>六年级</option>
            </select>
            <select className="qtx-select" defaultValue="">
              <option value="">全部状态</option>
              <option>在线</option>
              <option>离线</option>
            </select>
            <button className="qtx-btn" type="button">
              <SlidersIcon size={15} /> 筛选
            </button>
          </div>

          <div className="qtx-table-wrap">
            <table className="qtx-table">
              <thead>
                <tr>
                  <th>学生</th>
                  <th>兴趣主线</th>
                  <th>本周任务</th>
                  <th>画像状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className={s.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(s.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="qtx-avatar" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 13 }}>{s.avatar}</span>
                        <div>
                          <strong style={{ color: '#1e293b' }}>{s.name}</strong>
                          <div className="qtx-small qtx-muted">{s.grade} · {s.age} 岁</div>
                        </div>
                      </div>
                    </td>
                    <td>{s.interests[0]}</td>
                    <td>{s.solved}/{s.weeklyTasks} 已完成</td>
                    <td>
                      <span className={`qtx-badge ${s.status === '在线' ? 'qtx-badge-emerald' : 'qtx-badge-slate'}`}>
                        <span className="qtx-status-dot" style={{ background: s.status === '在线' ? '#059669' : '#94a3b8' }} />
                        {s.status === '在线' ? '画像已更新' : '待更新'}
                      </span>
                    </td>
                    <td><ChevronRightIcon size={16} style={{ color: '#cbd5e1' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="qtx-pagination">
            <span>共 128 名学生</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="qtx-page-btn" type="button"><ChevronLeftIcon size={16} /></button>
              {[1, 2, 3].map((p) => (
                <button key={p} className={`qtx-page-btn${p === 1 ? ' active' : ''}`} type="button">{p}</button>
              ))}
              <button className="qtx-page-btn" type="button"><ChevronRightIcon size={16} /></button>
            </div>
          </div>
        </div>

        <div className="qtx-col-5 qtx-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 14, background: 'linear-gradient(135deg,#eff6ff,#eef2ff)', borderBottom: '1px solid #eef2f7' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="qtx-avatar" style={{ width: 44, height: 44, borderRadius: 14, fontSize: 17 }}>{selected.avatar}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 15, color: '#1e293b' }}>{selected.name}</strong>
                  <span className="qtx-badge qtx-badge-blue">{selected.grade}</span>
                  <span className={`qtx-badge ${selected.status === '在线' ? 'qtx-badge-emerald' : 'qtx-badge-slate'}`}>
                    <span className="qtx-status-dot" style={{ background: selected.status === '在线' ? '#059669' : '#94a3b8' }} />
                    {selected.status}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {selected.tags.map((t) => (
                    <span key={t} className="qtx-tag qtx-tag-rose" style={{ padding: '4px 8px', fontSize: 11 }}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: 12, borderBottom: '1px solid #eef2f7' }}>
            <div className="qtx-tabs">
              {[
                ['profile', '学习画像'],
                ['tasks', '任务记录'],
                ['archive', '成长档案'],
              ].map(([id, label]) => (
                <button key={id} type="button" className={`qtx-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id as typeof tab)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: 16 }}>
            {tab === 'profile' ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>能力雷达</div>
                <RadarChart data={selected.radar} maxWidth={170} />
                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {selected.radar.map((r) => (
                    <span key={r.label} style={{ fontSize: 11, color: '#64748b' }}>
                      {r.label} <strong style={{ color: '#2563eb' }}>{r.value}</strong>
                    </span>
                  ))}
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>兴趣主线</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {selected.interests.map((i) => (
                      <span key={i} className="qtx-tag qtx-tag-indigo" style={{ padding: '4px 8px', fontSize: 11 }}>{i}</span>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>近期里程碑</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {selected.milestones.map((m) => (
                      <div key={m.label} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: '#475569' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563eb', flexShrink: 0 }} />
                        <span style={{ flex: 1, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.label}
                          <span className="qtx-faint" style={{ marginLeft: 6 }}>{m.time}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 12 }}>
                该标签页将在 P2 接入真实数据后展示。
              </div>
            )}

            <div style={{ display: 'grid', gap: 8, marginTop: 14, borderTop: '1px solid #eef2f7', paddingTop: 12 }}>
              <button className="qtx-btn qtx-btn-primary" type="button" style={{ padding: '8px 12px' }}>生成成长报告</button>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button className="qtx-btn qtx-btn-ghost-blue" type="button" style={{ padding: '8px 10px' }}>推送家长周报</button>
                <button className="qtx-btn" type="button" style={{ padding: '8px 10px' }}>记录一次沟通</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
