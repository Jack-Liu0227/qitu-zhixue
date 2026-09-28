'use client';

import { AlertIcon, BookIcon, SearchIcon, SlidersIcon } from '../../../components/icons';

/**
 * 知识库页面。
 *
 * ⚠️ 当前后端**没有任何知识库接口**（`services/api` 未提供 `/api/v1/teacher/knowledge*`，
 * 共享契约里也没有对应类型）。因此这里刻意只渲染一个诚实的「尚未接入」空态，
 * 不摆放假的材料列表、假的搜索框或假的统计数字——那会让老师以为能查到实际内容。
 *
 * 待后端补齐知识库查询接口后，本页再补充 loading / error / 权限失败三态与真实筛选。
 * 目前没有任何异步请求，所以不存在加载中或请求失败，界面直接给出空态说明。
 */
export default function KnowledgePage() {
  return (
    <div className="qtx-page">
      {/* 页面横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <BookIcon size={28} />
              </div>
            </div>
            <div>
              <h2>知识库</h2>
              <p>理论材料、案例与素材，供班主任备课与项目指导引用。</p>
            </div>
          </div>
          <div className="qtx-banner-slogan">好的材料，让探究有据可依。</div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">🚧 尚未接入</div>
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
              }}
            >
              📚
            </div>
          </div>
        </div>
      </section>

      {/* 空态：不编造材料 */}
      <section className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
        <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
        <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>知识库内容尚未接入</h2>
        <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.8, margin: 0 }}>
          平台的知识库检索服务还未上线，这里暂时没有可浏览的材料。
          <br />
          为避免误导，本页不会展示任何示例或虚构内容。
        </p>
      </section>

      {/* 规划中的能力，明确标注为未开放，不做成交互控件 */}
      <section className="qtx-card qtx-panel">
        <div className="qtx-panel-header">
          <div className="qtx-panel-title">
            <span className="dot" style={{ background: '#4f46e5' }} /> 规划中的能力
          </div>
          <span className="qtx-panel-hint">未开放</span>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="qtx-note" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SearchIcon size={16} style={{ flexShrink: 0 }} /> 按关键词、领域、年龄与难度检索理论材料
          </div>
          <div className="qtx-note" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SlidersIcon size={16} style={{ flexShrink: 0 }} /> 查看材料详情并引用到学生的指导上下文
          </div>
          <div className="qtx-note" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BookIcon size={16} style={{ flexShrink: 0 }} /> 收藏与整理常用素材
          </div>
        </div>
        <div className="qtx-note" style={{ marginTop: 14 }}>
          以上能力依赖尚未提供的知识库接口；接口就绪后本页会补充加载、空、错误与权限失败状态。
        </div>
      </section>
    </div>
  );
}
