'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ToolCatalog } from '../api/knowledge-center';
import { HierarchicalSchemaViewer } from './HierarchicalSchemaViewer';
import styles from './KnowledgeConfiguration.module.css';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface ToolParametersProps {
  catalog?: ToolCatalog;
  pending?: boolean;
  error?: string;
  fallbackTools?: string[];
  activeToolName?: string;
  onRefresh: () => void;
}

/** Render schemas as data, without resolving remote references. */
export function ToolParameters({
  catalog,
  pending,
  error,
  fallbackTools = [],
  activeToolName,
  onRefresh,
}: ToolParametersProps) {
  const [search, setSearch] = useState('');
  const [collapsedTools, setCollapsedTools] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (activeToolName) {
      setCollapsedTools((prev) => ({
        ...prev,
        [activeToolName]: false,
      }));
      const el = document.getElementById(`tool-param-card-${activeToolName}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeToolName]);

  // 融合从运行时 Catalog 获取的工具和静态配置中的 fallback 工具
  const displayTools = useMemo(() => {
    if (catalog?.tools && catalog.tools.length > 0) {
      return catalog.tools.map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema,
        hasLiveSchema: !!t.inputSchema,
      }));
    }
    return fallbackTools.map((name) => ({
      name,
      description: '已在 MCP 节点注册，等待服务连接并上报动态 inputSchema。',
      inputSchema: undefined,
      hasLiveSchema: false,
    }));
  }, [catalog?.tools, fallbackTools]);

  const filteredTools = useMemo(() => {
    if (!search.trim()) return displayTools;
    const q = search.toLowerCase();
    return displayTools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }, [displayTools, search]);

  const toggleTool = (toolName: string) => {
    setCollapsedTools((prev) => ({
      ...prev,
      [toolName]: !prev[toolName],
    }));
  };

  const expandAll = () => {
    setCollapsedTools({});
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    for (const t of displayTools) {
      next[t.name] = true;
    }
    setCollapsedTools(next);
  };

  return (
    <div className={styles.toolList} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 头部控制栏：工具总数、搜索过滤与操作 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          paddingBottom: '10px',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <strong style={{ fontSize: '14px', color: '#0f172a' }}>
            🛠️ 子工具与入参层级 ({filteredTools.length}/{displayTools.length})
          </strong>
          {catalog?.fetchedAt && (
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {catalog.stale ? '⚠️ 缓存已过期 · ' : '✓ '}
              探测于 {new Date(catalog.fetchedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className={styles.button}
            onClick={expandAll}
            style={{ padding: '3px 8px', fontSize: '11px' }}
          >
            全部展开
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={collapseAll}
            style={{ padding: '3px 8px', fontSize: '11px' }}
          >
            全部收起
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={onRefresh}
            disabled={pending}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            {pending ? '正在探测…' : '↻ 刷新工具目录'}
          </button>
        </div>
      </div>

      {/* 搜索过滤框 */}
      {displayTools.length > 3 && (
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索工具名称或描述..."
            style={{
              width: '100%',
              padding: '7px 12px',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '12.5px',
              boxSizing: 'border-box',
              background: '#f8fafc',
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: '#94a3b8',
                fontSize: '14px',
              }}
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* 状态与提示 */}
      {pending && (
        <div style={{ padding: '10px 14px', background: '#eff6ff', borderRadius: '6px', fontSize: '12px', color: '#1e40af' }}>
          ⏳ 正在通过 MCP 协议探测注册的工具与 JSON Schema 定义…
        </div>
      )}
      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', borderRadius: '6px', fontSize: '12px', color: '#b91c1c' }}>
          ⚠️ {error}
        </div>
      )}
      {catalog?.message && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '11.5px',
            background: catalog.stale ? '#fffbeb' : '#f8fafc',
            color: catalog.stale ? '#b45309' : '#64748b',
            border: '1px solid #e2e8f0',
          }}
        >
          ℹ️ {catalog.message}
        </div>
      )}

      {/* 工具列表为空时的提示 */}
      {!filteredTools.length && !pending && (
        <div
          style={{
            padding: '28px 16px',
            textAlign: 'center',
            background: '#f8fafc',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1',
            color: '#64748b',
            fontSize: '13px',
          }}
        >
          {search ? `未找到匹配 "${search}" 的子工具` : '当前 MCP 节点未登记任何子工具'}
        </div>
      )}

      {/* 工具卡片列表（支持直接展开、收起与入参层级透视） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filteredTools.map((tool) => {
          const isCollapsed = !!collapsedTools[tool.name];
          const isActive = tool.name === activeToolName;
          const schema = tool.inputSchema;
          return (
            <div
              key={tool.name}
              id={`tool-param-card-${tool.name}`}
              style={{
                border: isActive ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                borderRadius: '8px',
                background: isActive ? '#f8fafc' : '#ffffff',
                boxShadow: isActive ? '0 0 0 2px rgba(37, 99, 235, 0.15)' : '0 1px 2px rgba(0, 0, 0, 0.04)',
                overflow: 'hidden',
                transition: 'all 0.15s ease',
              }}
            >
              {/* 工具头部摘要栏（点击可折叠/展开） */}
              <div
                onClick={() => toggleTool(tool.name)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  background: isCollapsed ? '#ffffff' : '#f8fafc',
                  borderBottom: isCollapsed ? 'none' : '1px solid #e2e8f0',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px' }}>{isCollapsed ? '▶' : '▼'}</span>
                  <span style={{ fontSize: '15px' }}>🔧</span>
                  <strong style={{ fontSize: '13.5px', color: '#0f172a', fontFamily: 'monospace' }}>
                    {tool.name}
                  </strong>
                  {tool.hasLiveSchema ? (
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '1px 7px',
                        borderRadius: '4px',
                        background: '#dcfce7',
                        color: '#15803d',
                        fontWeight: 600,
                      }}
                    >
                      ✓ 实时 Schema
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '1px 7px',
                        borderRadius: '4px',
                        background: '#fef3c7',
                        color: '#b45309',
                        fontWeight: 500,
                      }}
                    >
                      静态注册
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                    {isCollapsed ? '点击展开参数规约' : '点击收起'}
                  </span>
                </div>
              </div>

              {/* 工具展开详情内容 */}
              {!isCollapsed && (
                <div style={{ padding: '14px 16px', background: '#ffffff' }}>
                  {tool.description ? (
                    <p style={{ margin: '0 0 12px', fontSize: '12.5px', color: '#475569', lineHeight: 1.6 }}>
                      {tool.description}
                    </p>
                  ) : (
                    <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                      该工具暂无详细文本描述。
                    </p>
                  )}

                  {schema ? (
                    <div style={{ marginTop: '8px' }}>
                      <HierarchicalSchemaViewer
                        schema={schema as Record<string, unknown>}
                        title={`${tool.name} 输入参数层级透视`}
                      />
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '12px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#64748b',
                      }}
                    >
                      <span>ℹ️ 服务尚未返回可解析的 <code>inputSchema</code> 属性字典。可点击上方「刷新工具目录」向 MCP 服务发送实时 <code>tools/list</code> 探测请求。</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
