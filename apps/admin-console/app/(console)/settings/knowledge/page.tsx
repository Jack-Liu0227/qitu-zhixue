'use client';

import { useState } from 'react';
import { CoursewareLibrary } from '../../../../lib/components/knowledge-library/CoursewareLibrary';
import { KnowledgeLibrary } from '../../../../lib/components/knowledge-library/KnowledgeLibrary';

export default function KnowledgeCenterPage() {
  const [activeTab, setActiveTab] = useState<'knowledge' | 'courseware'>('knowledge');

  return (
    <div className="admin-settings-page" style={{ paddingBottom: '32px' }}>
      <div className="settings-tabs-row" role="tablist" style={{ marginBottom: '16px' }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'knowledge'}
          className={`settings-tab-btn ${activeTab === 'knowledge' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('knowledge')}
        >
          <span>📚 知识库与资料授权</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'courseware'}
          className={`settings-tab-btn ${activeTab === 'courseware' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('courseware')}
        >
          <span>🎓 PBL 项目课件审查库</span>
        </button>
      </div>

      {activeTab === 'knowledge' ? <KnowledgeLibrary /> : <CoursewareLibrary />}
    </div>
  );
}
