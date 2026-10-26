'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminRuntimeSnapshot } from '@qitu/contracts';
import { fetchRuntimeSnapshot } from '../../../../lib/api/runtime';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import {
  InitializationCheckBadge,
  RuntimeHealthBadge,
  databaseLabel,
  dataModeLabel,
} from '../../../../lib/components/RuntimeViews';

const CORE_STORAGE_ENTITIES = [
  { module: '项目资产 (Projects)', table: 'projects / project_templates', engine: 'PostgreSQL Relational', policy: '版本化教学合同与绑定冻结', description: '记录正式项目状态机、TemplateVersionId、BindingId 及其不可变快照。' },
  { module: '探究与证据 (Evidence)', table: 'evidence_chain / observations', engine: 'PostgreSQL JSONB / Blob', policy: '双循环回执驱动', description: '探究过程回答、实验观测证据与 CER/Rubric 引用。' },
  { module: '掌握度门禁 (Mastery)', table: 'student_mastery_profiles', engine: 'PostgreSQL Relational', policy: 'Server-owned Gate', description: 'TheoryMastered 理论门禁状态，服务端口校验放行。' },
  { module: '模型网关 (Model Providers)', table: 'model_providers / models', engine: 'PostgreSQL Relational', policy: 'Admin 全局收口', description: '集中管理 API 网关协议、Key 指纹、连通性探测及上游候选模型池。' },
  { module: '知识中心 (Knowledge Bases)', table: 'knowledge_bases / courseware', engine: 'PostgreSQL + Vector', policy: 'IMA 权限受控', description: '项目绑定的知识检索范围与 5 维同行评审课件库。' },
  { module: '会话与审计 (Audit Logs)', table: 'audit_logs / runtime_events', engine: 'PostgreSQL Partitioned', policy: '幂等写入只读审计', description: '未成年人数据保护、干预动作与教学决策审计流水。' },
];

export default function AdminDatabasePage() {
  const [snapshot, setSnapshot] = useState<AdminRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [activeTab, setActiveTab] = useState<'checks' | 'schema'>('checks');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchRuntimeSnapshot());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('数据库状态加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const state = AdminStateViews({ loading, error, onRetry: load });
  if (state) return <div className="admin-settings-page">{state}</div>;
  if (!snapshot) return null;

  const checks = snapshot.initialization.checks;
  const readyChecksCount = checks.filter((c) => c.status === 'ready').length;

  return (
    <div className="admin-settings-page" style={{ paddingBottom: '32px' }}>
      {/* 紧凑页头 */}
      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1>数据库与存储治理</h1>
            <RuntimeHealthBadge health={snapshot.initialization.overall} />
          </div>
          <p>
            数据库 Schema 与数据迁移由 CLI 部署流程统一治理。Admin 只读审计连接状态与初始化证据，禁止通过 HTTP 执行 DDL 迁移。
          </p>
        </div>
        <div className="admin-page-header-actions">
          <button type="button" className="settings-action-btn" onClick={() => void load()}>
            🔄 刷新状态
          </button>
        </div>
      </div>

      {/* 核心指标卡片 */}
      <div className="provider-stats" style={{ marginBottom: '16px' }}>
        <div>
          <strong>{databaseLabel(snapshot.initialization.database)}</strong>
          <span>数据库引擎</span>
        </div>
        <div>
          <strong>{dataModeLabel(snapshot.initialization.dataMode)}</strong>
          <span>数据隔离模式</span>
        </div>
        <div>
          <strong>{snapshot.initialization.migrationVersion ?? '就绪'}</strong>
          <span>当前迁移版本</span>
        </div>
        <div>
          <strong>{readyChecksCount} / {checks.length}</strong>
          <span>检查项通过率</span>
        </div>
      </div>

      {/* 统一 Tabs 导航 */}
      <div className="settings-tabs-row" role="tablist" style={{ marginBottom: '16px' }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'checks'}
          className={`settings-tab-btn ${activeTab === 'checks' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('checks')}
        >
          <span>🩺 连接与初始化检查项</span>
          <span className="settings-tab-cnt">{checks.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'schema'}
          className={`settings-tab-btn ${activeTab === 'schema' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('schema')}
        >
          <span>🗄️ 核心实体与存储规范</span>
          <span className="settings-tab-cnt">{CORE_STORAGE_ENTITIES.length}</span>
        </button>
      </div>

      {/* Tab 1: 连接状态与基础数据检查 */}
      {activeTab === 'checks' && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
          <div
            style={{
              padding: '12px 18px',
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>运行时数据健全度核对单</strong>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              共 {checks.length} 项检查 · {readyChecksCount} 项正常
            </span>
          </div>

          <div className="admin-data-table admin-table-compact">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: '180px' }}>检查项目</th>
                  <th style={{ minWidth: '160px' }}>检查标识 (ID)</th>
                  <th style={{ minWidth: '100px' }}>状态</th>
                  <th style={{ minWidth: '280px' }}>证据与详情说明</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.id}>
                    <td>
                      <strong style={{ color: '#0f172a' }}>{check.label}</strong>
                    </td>
                    <td>
                      <code>{check.id}</code>
                    </td>
                    <td>
                      <InitializationCheckBadge status={check.status} />
                    </td>
                    <td>
                      <span style={{ color: check.detail ? '#334155' : '#94a3b8', fontSize: '12.5px' }}>
                        {check.detail ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: 核心实体与存储规范 */}
      {activeTab === 'schema' && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
          <div
            style={{
              padding: '12px 18px',
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>平台核心业务实体表分布与治理策略</strong>
            <span style={{ fontSize: '12px', color: '#64748b' }}>模块化单体架构数据规范</span>
          </div>

          <div className="admin-data-table admin-table-compact">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: '160px' }}>业务模块</th>
                  <th style={{ minWidth: '180px' }}>主要存储表</th>
                  <th style={{ minWidth: '140px' }}>存储引擎</th>
                  <th style={{ minWidth: '140px' }}>治理模式</th>
                  <th style={{ minWidth: '280px' }}>存储与一致性说明</th>
                </tr>
              </thead>
              <tbody>
                {CORE_STORAGE_ENTITIES.map((item) => (
                  <tr key={item.module}>
                    <td>
                      <strong style={{ color: '#0f172a' }}>{item.module}</strong>
                    </td>
                    <td>
                      <code>{item.table}</code>
                    </td>
                    <td>
                      <span style={{ fontSize: '12px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                        {item.engine}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '11.5px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: '#eff6ff',
                          color: '#2563eb',
                          fontWeight: 600,
                        }}
                      >
                        {item.policy}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '12.5px', color: '#64748b' }}>{item.description}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
