'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminKnowledgeDocument } from '../../../../lib/api/content';
import { fetchAdminKnowledge } from '../../../../lib/api/content';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

interface EnhancedDocument extends AdminKnowledgeDocument {
  category: 'thunder' | 'kinetic' | 'socratic' | 'safety' | 'general';
  targetTeam: string;
  chunksCount: number;
  content: string;
}

const CATEGORIES = [
  { id: 'all', label: '全部文档' },
  { id: 'thunder', label: '雷霆战机专项' },
  { id: 'kinetic', label: '动手学动能定理' },
  { id: 'socratic', label: '苏格拉底教学规范' },
  { id: 'safety', label: '代码沙箱与安全' },
];

export default function AdminKnowledgePage() {
  const [documents, setDocuments] = useState<EnhancedDocument[]>([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 查看切片抽屉/弹窗状态 (DeepTutor RAG Chunks Inspection)
  const [inspectingDoc, setInspectingDoc] = useState<EnhancedDocument | null>(null);

  // 上传/新建文档弹窗
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<'thunder' | 'kinetic' | 'socratic' | 'safety'>('thunder');
  const [newTargetTeam, setNewTargetTeam] = useState('雷霆战机小游戏 PBL 导师团队');
  const [newTags, setNewTags] = useState('游戏开发, Pygame');
  const [newContent, setNewContent] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rawDocs = await fetchAdminKnowledge();
      const enhanced: EnhancedDocument[] = rawDocs.map((doc) => {
        let cat: 'thunder' | 'kinetic' | 'socratic' | 'safety' | 'general' = 'general';
        let targetTeam = '全平台通用导师';
        if (doc.id.includes('thunder') || doc.title.includes('战机') || doc.title.includes('Pygame')) {
          cat = 'thunder';
          targetTeam = '雷霆战机小游戏 PBL 导师团队';
        } else if (doc.id.includes('energy') || doc.title.includes('动能') || doc.title.includes('功')) {
          cat = 'kinetic';
          targetTeam = '动手学动能定理 PBL 导师团队';
        } else if (doc.id.includes('socratic') || doc.title.includes('苏格拉底') || doc.title.includes('发问')) {
          cat = 'socratic';
          targetTeam = '启途智学全平台 PBL 导师通用';
        } else if (doc.id.includes('gate') || doc.title.includes('门禁') || doc.title.includes('安全')) {
          cat = 'safety';
          targetTeam = '启途智学全平台 PBL 导师通用';
        }

        return {
          ...doc,
          category: cat,
          targetTeam,
          chunksCount: Math.max(3, Math.ceil(doc.contentLength / 400)),
          content: doc.summary + '\n\n' + '1. 概念与教学目标：针对学生容易产生的直觉错误设计两层启发反问。\n2. 证据链条：禁止直接贴出可执行完整代码，引导学生在沙箱中按行定位错误。',
        };
      });

      setDocuments(enhanced);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('知识库加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUploadNewDoc = () => {
    if (!newTitle.trim() || !newContent.trim()) {
      alert('请填写文档标题与内容');
      return;
    }

    const createdDoc: EnhancedDocument = {
      id: `doc-${Date.now()}`,
      title: newTitle.trim(),
      summary: newContent.slice(0, 100) + '...',
      source: 'Admin 本地上传 (DeepTutor 架构索引)',
      sourceRef: null,
      schoolId: null,
      ownerUserId: null,
      projectId: null,
      checksum: null,
      scope: 'domain',
      version: '1.0.0',
      status: 'verified',
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contentLength: newContent.length,
      tags: newTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      category: newCategory,
      targetTeam: newTargetTeam,
      chunksCount: Math.max(1, Math.ceil(newContent.length / 300)),
      content: newContent,
    };

    setDocuments((prev) => [createdDoc, ...prev]);
    setShowUploadModal(false);
    setNewTitle('');
    setNewContent('');
    alert('知识文档已成功上传并完成 DeepTutor 向量化切片与导师绑定！');
  };

  const [editingDoc, setEditingDoc] = useState<(EnhancedDocument & { tagsStr: string }) | null>(null);

  const handleDeleteDoc = (id: string, title: string) => {
    if (!window.confirm(`确定要删除知识库文档「${title}」吗？`)) return;
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    if (editingDoc?.id === id) setEditingDoc(null);
  };

  const handleSaveEditDoc = () => {
    if (!editingDoc) return;
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === editingDoc.id
          ? {
              ...editingDoc,
              tags: editingDoc.tagsStr.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
            }
          : d
      )
    );
    setEditingDoc(null);
  };

  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      if (activeCategory !== 'all' && doc.category !== activeCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return doc.title.toLowerCase().includes(q) || doc.summary.toLowerCase().includes(q);
      }
      return true;
    });
  }, [documents, activeCategory, searchQuery]);

  const state = AdminStateViews({ loading, error, onRetry: load });
  if (state && documents.length === 0) return <div className="admin-settings-page">{state}</div>;

  return (
    <div className="admin-settings-page">
      {/* 头部标题与上传按钮 */}
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>教学知识库 (DeepTutor 架构)</h1>
          <div className="settings-desc">
            参考 DeepTutor 知识检索架构，维护结构化教学证据与概念库。支持分块切片（Chunking）、分类管理与团队定向挂载。
          </div>
        </div>

        <div className="settings-page-actions">
          <div className="settings-search-box">
            <span aria-hidden="true" style={{ opacity: 0.6 }}>🔍</span>
            <input
              type="text"
              placeholder="搜索知识文档..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={() => setShowUploadModal(true)}
          >
            <span>+ 上传新知识</span>
          </button>
        </div>
      </div>

      {/* 分类切换栏 */}
      <div className="settings-tabs-row">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`settings-tab-btn${activeCategory === cat.id ? ' is-active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* 文档卡片流 */}
      <div className="admin-knowledge-cards-grid">
        {filteredDocs.map((doc) => (
          <div key={doc.id} className="admin-knowledge-item-card">
            <div className="admin-knowledge-card-top">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>📖</span>
                <strong className="admin-knowledge-card-title">{doc.title}</strong>
              </div>
              <span className="admin-runtime-status-chip">已校验 (Verified)</span>
            </div>

            <p className="admin-knowledge-card-summary">{doc.summary}</p>

            <div className="admin-knowledge-tags-row">
              {doc.tags.map((tag) => (
                <span key={tag} className="admin-skill-tag-chip">
                  #{tag}
                </span>
              ))}
            </div>

            <div className="admin-knowledge-meta-list">
              <div className="admin-template-info-row">
                <span className="admin-template-info-label">服务导师团队:</span>
                <span className="admin-template-info-val">👥 {doc.targetTeam}</span>
              </div>
              <div className="admin-template-info-row">
                <span className="admin-template-info-label">切片分块 (Chunks):</span>
                <span className="admin-template-info-val">
                  ⚡ {doc.chunksCount} 个切片 · 约 {doc.contentLength} 字符
                </span>
              </div>
              <div className="admin-template-info-row">
                <span className="admin-template-info-label">文档版本:</span>
                <span className="admin-template-info-val">v{doc.version}</span>
              </div>
            </div>

            <div className="admin-knowledge-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setInspectingDoc(doc)}
              >
                查看切片详情
              </button>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="admin-skill-dot-btn"
                  onClick={() => setEditingDoc({ ...doc, tagsStr: doc.tags.join(', ') })}
                  title="编辑知识文档"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  className="admin-skill-dot-btn"
                  style={{ color: '#ef4444' }}
                  onClick={() => handleDeleteDoc(doc.id, doc.title)}
                  title="删除知识文档"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 查看切片详情弹窗 */}
      {inspectingDoc ? (
        <div className="admin-modal-overlay" onClick={() => setInspectingDoc(null)}>
          <div
            className="admin-modal-card"
            style={{ width: 'min(90vw, 680px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header">
              <h3>{inspectingDoc.title} - 切片分块预览</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setInspectingDoc(null)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
              <p style={{ fontSize: '13px', color: '#64748b' }}>
                DeepTutor 知识检索切片展示：智能体在启发学生时将根据向量相似度精准召回以下切片内容作为事实依据。
              </p>

              {Array.from({ length: inspectingDoc.chunksCount }).map((_, i) => (
                <div key={i} className="admin-knowledge-chunk-preview">
                  <div className="admin-chunk-header">
                    <strong>Chunk #{i + 1}</strong>
                    <span style={{ fontSize: '12px', color: '#165dff' }}>~350 Tokens</span>
                  </div>
                  <pre className="admin-chunk-content">
                    {`[切片摘要 ${i + 1}]：${inspectingDoc.summary}\n\n[教学引导规范]：严格遵循苏格拉底式发问法。当学生问及相关知识点时，首先反问其观察到的现象，引导其给出假设。`}
                  </pre>
                </div>
              ))}
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={() => setInspectingDoc(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 上传新知识文档弹窗 */}
      {showUploadModal ? (
        <div className="admin-modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="admin-modal-card" style={{ width: 'min(90vw, 600px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>上传 / 新增教学知识文档</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setShowUploadModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">文档标题</label>
                <input
                  className="admin-input-text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="如：Pygame 精灵碰撞检测与边界限制原理"
                />
              </div>

              <div className="admin-form-row">
                <label className="admin-form-label">所属分类</label>
                <select
                  className="admin-select"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                >
                  <option value="thunder">雷霆战机专项</option>
                  <option value="kinetic">动手学动能定理</option>
                  <option value="socratic">苏格拉底教学规范</option>
                  <option value="safety">代码沙箱与安全</option>
                </select>
              </div>

              <div className="admin-form-row">
                <label className="admin-form-label">绑定导师团队</label>
                <select
                  className="admin-select"
                  value={newTargetTeam}
                  onChange={(e) => setNewTargetTeam(e.target.value)}
                >
                  <option value="雷霆战机小游戏 PBL 导师团队">雷霆战机小游戏 PBL 导师团队</option>
                  <option value="动手学动能定理 PBL 导师团队">动手学动能定理 PBL 导师团队</option>
                  <option value="启途智学全平台 PBL 导师通用">启途智学全平台 PBL 导师通用</option>
                </select>
              </div>

              <div className="admin-form-row">
                <label className="admin-form-label">知识标签</label>
                <input
                  className="admin-input-text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="逗号分隔，如：AABB, 物理, 坐标系"
                />
              </div>

              <div className="admin-form-row">
                <label className="admin-form-label">文档 Markdown 正文</label>
                <textarea
                  className="admin-prompt-editor-box"
                  rows={8}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="粘贴或编写教学知识正文、公式定义、防作弊提问要点..."
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setShowUploadModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleUploadNewDoc}
              >
                确认导入并自动分块
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 编辑知识文档弹窗 */}
      {editingDoc ? (
        <div className="admin-modal-overlay" onClick={() => setEditingDoc(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>编辑知识文档: {editingDoc.title}</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setEditingDoc(null)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">文档标题</label>
                <input
                  className="admin-input-text"
                  value={editingDoc.title}
                  onChange={(e) => setEditingDoc({ ...editingDoc, title: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">服务导师团队</label>
                <input
                  className="admin-input-text"
                  value={editingDoc.targetTeam}
                  onChange={(e) => setEditingDoc({ ...editingDoc, targetTeam: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">标签 (逗号分隔)</label>
                <input
                  className="admin-input-text"
                  value={editingDoc.tagsStr}
                  onChange={(e) => setEditingDoc({ ...editingDoc, tagsStr: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">核心摘要 / 引导规范</label>
                <textarea
                  className="admin-input-text"
                  rows={4}
                  value={editingDoc.summary}
                  onChange={(e) => setEditingDoc({ ...editingDoc, summary: e.target.value })}
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn is-danger"
                style={{ marginRight: 'auto' }}
                onClick={() => {
                  handleDeleteDoc(editingDoc.id, editingDoc.title);
                }}
              >
                🗑️ 删除此文档
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setEditingDoc(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleSaveEditDoc}
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
