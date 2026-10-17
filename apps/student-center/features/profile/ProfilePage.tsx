'use client';

import { useMemo, useState } from 'react';
import { SectionCard } from '@qitu/ui';
import { DeviceManagement } from './DeviceManagement';

interface CompetencyDimension {
  id: string;
  name: string;
  score: number;
  benchmark: number;
  description: string;
  evidenceCount: number;
  level: string;
}

const COMPETENCY_DATA: CompetencyDimension[] = [
  {
    id: 'critical_thinking',
    name: '批判性思维',
    score: 88,
    benchmark: 75,
    description: '善于质疑直觉结论，通过控制变量法与反向论证严谨排查问题。',
    evidenceCount: 14,
    level: '高阶精通',
  },
  {
    id: 'planning',
    name: '项目规划力',
    score: 82,
    benchmark: 70,
    description: '能将宏大课题自主拆解为可操作的小节点里程碑，时间把控严谨。',
    evidenceCount: 9,
    level: '熟练进阶',
  },
  {
    id: 'practice',
    name: '动手实践力',
    score: 94,
    benchmark: 72,
    description: '原型搭建与代码调试能力出众，能迅速把理论假说做成可运行作品。',
    evidenceCount: 22,
    level: '卓越领航',
  },
  {
    id: 'interdisciplinary',
    name: '跨学科探究',
    score: 79,
    benchmark: 68,
    description: '善于融合生态、物理与计算机知识，正处于深度融合进阶期。',
    evidenceCount: 8,
    level: '扎实发展',
  },
  {
    id: 'communication',
    name: '协同表达',
    score: 85,
    benchmark: 74,
    description: '能用结构化语言向导师清晰阐述设计意图与答辩推演逻辑。',
    evidenceCount: 11,
    level: '熟练进阶',
  },
  {
    id: 'reflection',
    name: '元认知复盘',
    score: 91,
    benchmark: 71,
    description: '对失败实验和异常数据有高度敏感性，善于从偏差中提炼核心规律。',
    evidenceCount: 16,
    level: '高阶精通',
  },
];

const MILESTONE_BADGES = [
  { id: 'b1', title: '独立创作者', desc: '独立完成全周期项目作品交付', icon: '🏆', date: '2026-10-04' },
  { id: 'b2', title: '实证科学家', desc: '完成 20+ 次不可篡改实验证据沉淀', icon: '🔬', date: '2026-09-28' },
  { id: 'b3', title: '代码架构初探', desc: '掌握游戏主循环与模块化解耦思想', icon: '💻', date: '2026-09-22' },
  { id: 'b4', title: '生态观察家', desc: '完成雨水微滤系统全套水质对比分析', icon: '🌿', date: '2026-09-15' },
];

export function ProfilePage() {
  const [selectedDimension, setSelectedDimension] = useState<CompetencyDimension>(COMPETENCY_DATA[0]!);

  // 计算六维雷达图多边形顶点坐标 (中心点 150, 150，半径 110)
  const radarGeometry = useMemo(() => {
    const cx = 150;
    const cy = 150;
    const r = 105;
    const total = COMPETENCY_DATA.length;

    const getCoord = (score: number, index: number) => {
      const angle = (Math.PI * 2 / total) * index - Math.PI / 2;
      const dist = (score / 100) * r;
      return {
        x: cx + dist * Math.cos(angle),
        y: cy + dist * Math.sin(angle),
      };
    };

    // 背景参考网格刻度 (25%, 50%, 75%, 100%)
    const gridLevels = [25, 50, 75, 100].map((level) => {
      return COMPETENCY_DATA.map((_, i) => {
        const pt = getCoord(level, i);
        return `${pt.x},${pt.y}`;
      }).join(' ');
    });

    // 学生得分多边形
    const studentPoints = COMPETENCY_DATA.map((d, i) => {
      const pt = getCoord(d.score, i);
      return `${pt.x},${pt.y}`;
    }).join(' ');

    // 年级基准线多边形
    const benchmarkPoints = COMPETENCY_DATA.map((d, i) => {
      const pt = getCoord(d.benchmark, i);
      return `${pt.x},${pt.y}`;
    }).join(' ');

    // 顶点坐标用于交互点和标注
    const vertexPoints = COMPETENCY_DATA.map((d, i) => {
      const pt = getCoord(d.score, i);
      const labelPt = getCoord(122, i);
      return { ...d, pt, labelPt, index: i };
    });

    return { gridLevels, studentPoints, benchmarkPoints, vertexPoints };
  }, []);

  return (
    <div className="qitu-profile-page">
      {/* 头部学生基本信息看板 */}
      <div className="qitu-profile-hero-card">
        <div className="qitu-profile-hero-avatar-wrap">
          <div className="qitu-profile-hero-avatar">学</div>
          <span className="qitu-profile-level-badge">LV.3 探索先锋</span>
        </div>

        <div className="qitu-profile-hero-meta">
          <div className="qitu-profile-hero-title-row">
            <h1>李明（学生个人画像）</h1>
            <span className="qitu-profile-school-tag">北京海淀科创实验中学 · 初一年级</span>
          </div>
          <p className="qitu-profile-hero-motto">
            “从真实世界的好奇心出发，让每一个作品和实验数据成为证明能力的硬证据。”
          </p>

          <div className="qitu-profile-stats-row">
            <div className="qitu-profile-stat-item">
              <span className="qitu-stat-label">综合能力指数</span>
              <strong className="qitu-stat-value is-highlight">86.5</strong>
            </div>
            <div className="qitu-profile-stat-item">
              <span className="qitu-stat-label">已交付项目</span>
              <strong className="qitu-stat-value">3 个</strong>
            </div>
            <div className="qitu-profile-stat-item">
              <span className="qitu-stat-label">探究证据沉淀</span>
              <strong className="qitu-stat-value">36 项</strong>
            </div>
            <div className="qitu-profile-stat-item">
              <span className="qitu-stat-label">AI搭档思维启发</span>
              <strong className="qitu-stat-value">142 轮</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="qitu-profile-content-grid">
        {/* 左侧：六维能力雷达可视化 */}
        <div className="qitu-profile-col">
          <SectionCard title="核心素养雷达图">
            <div className="qitu-radar-container">
              <div className="qitu-radar-legend">
                <span className="qitu-legend-item is-student">
                  <span className="qitu-legend-color" /> 我的能力画像
                </span>
                <span className="qitu-legend-item is-benchmark">
                  <span className="qitu-legend-color" /> 同学段常模基准
                </span>
              </div>

              <div className="qitu-radar-svg-wrap">
                <svg viewBox="0 0 300 300" className="qitu-radar-svg">
                  {/* 背景参考层 */}
                  {radarGeometry.gridLevels.map((poly, idx) => (
                    <polygon key={idx} points={poly} className="qitu-radar-grid-polygon" />
                  ))}

                  {/* 轴线 */}
                  {radarGeometry.vertexPoints.map((v) => (
                    <line
                      key={v.id}
                      x1="150"
                      y1="150"
                      x2={v.pt.x}
                      y2={v.pt.y}
                      className="qitu-radar-axis"
                    />
                  ))}

                  {/* 年级基准线 */}
                  <polygon
                    points={radarGeometry.benchmarkPoints}
                    className="qitu-radar-benchmark-polygon"
                  />

                  {/* 学生能力多边形 */}
                  <polygon
                    points={radarGeometry.studentPoints}
                    className="qitu-radar-student-polygon"
                  />

                  {/* 顶点交互圆形 */}
                  {radarGeometry.vertexPoints.map((v) => (
                    <g key={v.id} onClick={() => setSelectedDimension(v)} style={{ cursor: 'pointer' }}>
                      <circle
                        cx={v.pt.x}
                        cy={v.pt.y}
                        r={selectedDimension.id === v.id ? 7 : 5}
                        className={`qitu-radar-node-circle${selectedDimension.id === v.id ? ' is-active' : ''}`}
                      />
                      <text
                        x={v.labelPt.x}
                        y={v.labelPt.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className={`qitu-radar-label${selectedDimension.id === v.id ? ' is-active' : ''}`}
                      >
                        {v.name} ({v.score})
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              {/* 选中维度的深度解析卡片 */}
              <div className="qitu-dimension-detail-card">
                <div className="qitu-dimension-detail-header">
                  <div>
                    <strong>{selectedDimension.name}</strong>
                    <span className="qitu-dimension-level-tag">{selectedDimension.level}</span>
                  </div>
                  <span className="qitu-dimension-score">
                    {selectedDimension.score} <span>/ 100</span>
                  </span>
                </div>
                <p className="qitu-dimension-desc">{selectedDimension.description}</p>
                <div className="qitu-dimension-footer">
                  <span>已沉淀真实过程证据：<strong>{selectedDimension.evidenceCount} 条</strong></span>
                  <span className="qitu-dimension-lead">超同学段平均 +{selectedDimension.score - selectedDimension.benchmark} 分</span>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* 右侧：能力特质分析与进阶指南 */}
        <div className="qitu-profile-col">
          <SectionCard title="能力特质与优势解读">
            <div className="qitu-persona-traits-list">
              <div className="qitu-trait-card is-primary">
                <div className="qitu-trait-icon">🔬</div>
                <div className="qitu-trait-info">
                  <strong>实证与代码验证驱动</strong>
                  <p>
                    在《雷霆战机》与《雨水花园》项目中，多次在动手编码前先通过数学公式或物理模型推演，表现出卓越的实践动手力（94分）与逻辑复盘素养。
                  </p>
                </div>
              </div>

              <div className="qitu-trait-card">
                <div className="qitu-trait-icon">💡</div>
                <div className="qitu-trait-info">
                  <strong>善于将问题转化为系统原型</strong>
                  <p>
                    擅长借助 AI搭档进行苏格拉底式反思，能从模糊的现象迅速定位到因果链核心，问题拆解能力处于同龄人前列。
                  </p>
                </div>
              </div>

              <div className="qitu-trait-card is-suggest">
                <div className="qitu-trait-icon">📈</div>
                <div className="qitu-trait-info">
                  <strong>下一步推荐进阶方向</strong>
                  <p>
                    建议在下一个项目中强化<strong>跨学科文献研读</strong>与学术引用规范（当前79分），尝试通过跨界对比阅读提升理论论证深度。
                  </p>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="能力里程碑与认证徽章">
            <div className="qitu-profile-badges-grid">
              {MILESTONE_BADGES.map((b) => (
                <div key={b.id} className="qitu-profile-badge-item">
                  <div className="qitu-badge-icon">{b.icon}</div>
                  <div className="qitu-badge-meta">
                    <strong>{b.title}</strong>
                    <p>{b.desc}</p>
                    <small>获得于 {b.date}</small>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
      <DeviceManagement />
    </div>
  );
}
