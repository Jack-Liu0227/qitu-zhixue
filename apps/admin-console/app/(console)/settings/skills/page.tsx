'use client';

import { useMemo, useState } from 'react';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

interface SkillItem {
  id: string;
  name: string;
  description: string;
  status: 'ready' | 'pending';
  source: 'builtin' | 'custom';
  version: string;
  agents: string[];
}

const BUILTIN_SKILLS: SkillItem[] = [
  {
    id: 'tutor-guided-learning',
    name: 'tutor-guided-learning',
    description: '短轮次苏格拉底式启发教学，引导学生自主探索与思考，严禁直出完整代码。',
    status: 'ready',
    source: 'builtin',
    version: '1.2.0',
    agents: ['总导师', '原理教练', '代码向导', '答辩导师'],
  },
  {
    id: 'thunder-fighter-engine',
    name: 'thunder-fighter-engine',
    description: '雷霆战机 Python/Pygame 游戏主循环引擎与渲染规范，包含帧率锁定与事件队列控制。',
    status: 'ready',
    source: 'builtin',
    version: '2.0.1',
    agents: ['原理教练', '代码向导'],
  },
  {
    id: 'aabb-collision-solver',
    name: 'aabb-collision-solver',
    description: '二维轴对齐包围盒 (AABB) 碰撞检测算法推导与子弹击中敌机判定数学规范。',
    status: 'ready',
    source: 'builtin',
    version: '1.0.4',
    agents: ['原理教练', '代码向导'],
  },
  {
    id: 'pbl-deliverable-qa',
    name: 'pbl-deliverable-qa',
    description: 'PBL 成果防御性质量评审、代码规范审计与答辩问卷生成器。',
    status: 'ready',
    source: 'custom',
    version: '0.9.5',
    agents: ['答辩导师'],
  },
];

export default function SkillsSettingsPage() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillItem | null>(null);

  const tabs = useMemo(() => {
    const builtinCount = BUILTIN_SKILLS.filter((s) => s.source === 'builtin').length;
    const customCount = BUILTIN_SKILLS.filter((s) => s.source === 'custom').length;
    return [
      { id: 'all', label: '全部', count: BUILTIN_SKILLS.length },
      { id: 'builtin', label: '内置技能', count: builtinCount },
      { id: 'custom', label: '自定义技能', count: customCount },
    ];
  }, []);

  const filtered = useMemo(() => {
    return BUILTIN_SKILLS.filter((skill) => {
      if (activeTab === 'builtin' && skill.source !== 'builtin') return false;
      if (activeTab === 'custom' && skill.source !== 'custom') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [search, activeTab]);

  const handleTest = (id: string) => {
    setTestingId(id);
    setTimeout(() => {
      setTestingId(null);
      alert(`技能 ${id} 校验成功：语法定义与 Prompt 契约均有效！`);
    }, 600);
  };

  return (
    <AionSettingsParadigm
      title="技能"
      description={
        <span>
          管理可供 Agent 与团队调用的技能能力包。技能遵循 Prompt 与规则约定，随上下文动态注入。
          <a href="#">查看技能规范</a>
        </span>
      }
      searchPlaceholder="搜索技能..."
      searchQuery={search}
      onSearchChange={setSearch}
      primaryActionLabel="导入技能包"
      onPrimaryAction={() => alert('已开启技能包导入向导')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {filtered.length === 0 ? (
        <div className="settings-empty">暂无匹配的技能包</div>
      ) : (
        filtered.map((skill) => (
          <RowCard
            key={skill.id}
            avatarText="⚡"
            avatarBg={skill.source === 'builtin' ? '#165dff' : '#f77234'}
            name={skill.name}
            statusText={skill.status === 'ready' ? '可用' : '待配置'}
            statusType={skill.status === 'ready' ? 'ok' : 'off'}
            description={`${skill.description} (v${skill.version})`}
            avatarStack={skill.agents.map((a) => a.slice(0, 1))}
            testLabel="校验技能"
            testLoading={testingId === skill.id}
            onTestConnection={() => handleTest(skill.id)}
            editLabel="查看定义"
            onEdit={() => setSelectedSkill(skill)}
          />
        ))
      )}

      {selectedSkill ? (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setSelectedSkill(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: 540,
              maxWidth: '90vw',
              padding: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px' }}>⚡ {selectedSkill.name}</h3>
            <p style={{ color: '#4e5969', fontSize: 13, lineHeight: 1.6 }}>{selectedSkill.description}</p>
            <div style={{ marginTop: 14, fontSize: 13 }}>
              <div><strong>版本：</strong> {selectedSkill.version}</div>
              <div style={{ marginTop: 6 }}>
                <strong>关联 Agent：</strong> {selectedSkill.agents.join('、')}
              </div>
            </div>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="settings-pill-btn"
                onClick={() => setSelectedSkill(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AionSettingsParadigm>
  );
}
