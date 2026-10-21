'use client';

import { createPendingGrowthCompetencyDimensions, type GrowthCompetencyDimension, type GrowthCompetencyOverview } from '@qitu/contracts';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { StudentLink } from '../../components/student-link';
import { buildRadarGeometry, radarPoint, radarPolygon } from './radarGeometry';
import styles from './Profile.module.css';

const LABEL_POSITIONS = [
  { left: '50%', top: '9%' }, { left: '83%', top: '29%' }, { left: '83%', top: '71%' },
  { left: '50%', top: '91%' }, { left: '17%', top: '71%' }, { left: '17%', top: '29%' },
];

function statusLabel(dimension: GrowthCompetencyDimension): string {
  if (dimension.status === 'assessed') return '已确认评价';
  if (dimension.status === 'pending_assessment') return '等待评价';
  if (dimension.status === 'observed') return '已有学习记录';
  return '待观察';
}

function DimensionGlyph({ index }: { index: number }) {
  const paths = [
    'M15 15l5 5M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM10 7v4m0 3h.01',
    'M9 3h6m-5 0v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M8 15h8',
    'M5 5h4v4H5Zm10 10h4v4h-4ZM7 9v8h8m-6-10h8v8',
    'm4 19 1-5L15 4l5 5-10 10-6 1Zm9-13 5 5M5 14l5 5',
    'M4 4h16v12H9l-5 4V4Zm4 5h8m-8 3h5',
    'M20 7v5h-5M4 17v-5h5m-5 0a8 8 0 0 1 13-6l3 3M4 15l3 3a8 8 0 0 0 13-6',
  ];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[index] ?? paths[0]} /></svg>;
}

export function CompetencyRadar({ overview }: { overview: GrowthCompetencyOverview | null }) {
  const dimensions = overview?.dimensions ?? createPendingGrowthCompetencyDimensions();
  const [selectedIndex, setSelectedIndex] = useState(1);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const selected = dimensions[selectedIndex] ?? dimensions[0];
  const geometry = buildRadarGeometry(dimensions.map((dimension) => dimension.status === 'assessed'
    ? { value: dimension.value, minimum: dimension.assessment.scaleMin, maximum: dimension.assessment.scaleMax } : null));

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (selectedIndex + 1) % 6;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (selectedIndex + 5) % 6;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 5;
    else return;
    event.preventDefault();
    setSelectedIndex(next);
    buttons.current[next]?.focus();
  }

  return <section className={styles.radarLayout} aria-label="六维学习画像">
    <div className={styles.radarPanel}>
      <div className={styles.panelHeading}><h2>六维成长画像</h2><span>{geometry.confirmedCount} / 6 个维度已评价</span></div>
      <div className={styles.chart}>
        <svg className={styles.chartSvg} viewBox="0 0 600 500" role="img" aria-labelledby={`${id}-title ${id}-description`}>
          <title id={`${id}-title`}>六维学习画像雷达图</title>
          <desc id={`${id}-description`}>仅绘制有已确认评价的维度。待观察不代表零分。可使用图外维度按钮或数据表查看详情。</desc>
          {[1, 2, 3, 4, 5].map((ring) => <polygon key={ring} points={radarPolygon(Array.from({ length: 6 }, (_, index) => radarPoint(index, 156 * ring / 5)))} className={styles.gridRing} />)}
          {dimensions.map((dimension, index) => {
            const end = radarPoint(index, 156);
            return <g key={dimension.id}><line x1="300" y1="250" x2={end.x} y2={end.y} className={styles.gridAxis} />
              <circle cx={end.x} cy={end.y} r={index === selectedIndex ? 6 : 4} className={index === selectedIndex ? styles.selectedAnchor : styles.axisAnchor} /></g>;
          })}
          {geometry.polygon && <polygon points={geometry.polygon} className={styles.resultArea} />}
          {geometry.segments.map((segment, index) => <line key={index} x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y} className={styles.resultLine} />)}
          {geometry.points.map((point, index) => point && <circle key={index} cx={point.x} cy={point.y} r="5" className={styles.resultPoint} />)}
        </svg>
        {geometry.confirmedCount === 0 && <div className={styles.chartMessage}><span>每一次探索，都留下线索</span><strong>还没有已确认的<br />六维评价</strong></div>}
        <div className={styles.axisTabs} role="tablist" aria-label="选择一个学习维度" onKeyDown={navigate}>
          {dimensions.map((dimension, index) => <button key={dimension.id} type="button" role="tab"
            id={`${id}-${dimension.id}`} aria-selected={selectedIndex === index} aria-controls={`${id}-detail`}
            tabIndex={selectedIndex === index ? 0 : -1} className={styles.axisButton} data-selected={selectedIndex === index}
            style={LABEL_POSITIONS[index]} ref={(element) => { buttons.current[index] = element; }}
            onClick={() => setSelectedIndex(index)}>
            <span className={styles.axisTitle}>{dimension.title}</span><span className={styles.axisStatus}>{dimension.status === 'assessed' ? `已评价 ${dimension.value}` : statusLabel(dimension)}</span>
          </button>)}
        </div>
      </div>
      <p className={styles.chartCaption}>{geometry.confirmedCount === 0 ? '待观察代表还没有已确认评价，不代表能力高低。'
        : geometry.confirmedCount < 6 ? '仅显示已有评价的维度，空缺位置保留待观察。' : '各轴按对应评价量表展示，可选择维度查看依据。'}</p>
      <details className={styles.dataTable}><summary>查看六维数据表</summary><div className={styles.tableScroll}>
        <table><caption>六个维度的评价与证据状态</caption><thead><tr><th scope="col">学习维度</th><th scope="col">当前状态</th><th scope="col">评价</th></tr></thead>
          <tbody>{dimensions.map((dimension) => <tr key={dimension.id}><th scope="row">{dimension.title}</th><td>{statusLabel(dimension)}</td>
            <td>{dimension.status === 'assessed' ? `${dimension.value}（量表 ${dimension.assessment.scaleMin}–${dimension.assessment.scaleMax}）` : '暂无评价'}</td></tr>)}</tbody>
        </table></div></details>
    </div>
    <div className={styles.detailPanel} id={`${id}-detail`} role="tabpanel" aria-labelledby={`${id}-${selected.id}`}>
      <p className={styles.detailEyebrow}>所选维度详情</p>
      <div className={styles.detailHeading}><span className={styles.dimensionGlyph}><DimensionGlyph index={selectedIndex} /></span><div><h2>{selected.title}</h2><p>{selected.description}</p></div></div>
      <div className={styles.detailBody} key={selected.id}>
        <div className={styles.observation}>
          <span className={styles.observationMark} aria-hidden="true">{selected.status === 'assessed' ? '✓' : '＋'}</span>
          <div><h3>{selected.status === 'assessed' ? '每一项评价，都能找到依据' : selected.status === 'pending_observation' ? '尚无已确认评价' : '学习记录已留下，等待评价'}</h3>
            {selected.status === 'assessed' ? <><p className={styles.assessedValue}>{selected.value}<span>量表范围 {selected.assessment.scaleMin}–{selected.assessment.scaleMax}</span></p><p>关联 {selected.evidenceRefs.length} 条学习证据。评价于 {new Date(selected.assessment.assessedAt).toLocaleDateString('zh-CN')}。</p></>
              : <p>{!overview ? '当前还没有可展示的六维评价。你可以先探索，在成长轨迹中回看已有记录。'
                : overview.assessmentUnavailableReason === 'framework_not_configured'
                ? '这个维度的评价方式尚未启用。你可以继续探究，真实的学习记录会保留下来。'
                : selected.evidenceRefs.length > 0 ? '相关证据已经保留，评价确认后会在这里展示。' : '从一次真实的探究开始，记录想法、观察与修改，让评价有据可依。'}</p>}
            <StudentLink className={styles.primaryLink} href={selected.status === 'assessed' ? '/student/growth' : '/student/inspiration'}>
              {selected.status === 'assessed' ? '查看成长记录' : '开始一次探索'}<span aria-hidden="true">→</span>
            </StudentLink>
          </div>
        </div>
        <div className={styles.guidance}><h3>可以留下怎样的学习记录？</h3><p>{selected.evidenceGuidance}</p></div>
        <div className={styles.evidencePath}><h3>让思考留下证据</h3><ol>
          {['学习表达', '探究记录', '作品与反思', '确认评价'].map((step, index) => <li key={step}><span className={styles.pathIcon} aria-hidden="true"><DimensionGlyph index={[0, 1, 3, 5][index] ?? 0} /></span><strong>{step}</strong></li>)}
        </ol><p>学习记录需要经过评价，才会形成这一维度的结果。</p></div>
      </div>
    </div>
  </section>;
}
