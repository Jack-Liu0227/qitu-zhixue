'use client';

import { useState } from 'react';

export interface HierarchicalSchemaViewerProps {
  schema?: Record<string, unknown> | null;
  title?: string;
  defaultExpanded?: boolean;
}

interface PropertyNodeProps {
  name: string;
  propSchema: Record<string, unknown>;
  isRequired: boolean;
  level: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function PropertyNode({ name, propSchema, isRequired, level }: PropertyNodeProps) {
  const [collapsed, setCollapsed] = useState(false);

  const rawType = propSchema.type;
  const typeStr = Array.isArray(rawType) ? rawType.join(' | ') : String(rawType || 'any');
  const description = typeof propSchema.description === 'string' ? propSchema.description : '';
  const enumVals = Array.isArray(propSchema.enum) ? propSchema.enum : null;

  // Extract constraints
  const constraints: string[] = [];
  if (typeof propSchema.minimum === 'number') constraints.push(`min: ${propSchema.minimum}`);
  if (typeof propSchema.maximum === 'number') constraints.push(`max: ${propSchema.maximum}`);
  if (typeof propSchema.minLength === 'number') constraints.push(`minLength: ${propSchema.minLength}`);
  if (typeof propSchema.maxLength === 'number') constraints.push(`maxLength: ${propSchema.maxLength}`);
  if (typeof propSchema.minItems === 'number') constraints.push(`minItems: ${propSchema.minItems}`);
  if (typeof propSchema.maxItems === 'number') constraints.push(`maxItems: ${propSchema.maxItems}`);
  if (typeof propSchema.pattern === 'string') constraints.push(`pattern: ${propSchema.pattern}`);

  // Child properties for object
  const childProperties = isRecord(propSchema.properties) ? propSchema.properties : null;
  const childRequired = Array.isArray(propSchema.required) ? (propSchema.required as string[]) : [];

  // Child items for array of objects
  const itemsSchema = isRecord(propSchema.items) ? propSchema.items : null;
  const arrayItemProps = itemsSchema && isRecord(itemsSchema.properties) ? itemsSchema.properties : null;
  const arrayItemRequired = itemsSchema && Array.isArray(itemsSchema.required) ? (itemsSchema.required as string[]) : [];

  const hasChildren = (childProperties && Object.keys(childProperties).length > 0) ||
                      (arrayItemProps && Object.keys(arrayItemProps).length > 0);

  const typeDisplay = arrayItemProps ? 'array<object>' : typeStr;

  return (
    <div
      style={{
        marginLeft: level > 0 ? '16px' : '0',
        paddingLeft: level > 0 ? '10px' : '0',
        borderLeft: level > 0 ? '1.5px solid #e2e8f0' : 'none',
        marginTop: '6px',
        marginBottom: '6px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          padding: '6px 10px',
          background: level % 2 === 0 ? '#ffffff' : '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          fontSize: '12px',
          lineHeight: '1.5',
        }}
      >
        {/* 折叠按钮 */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            style={{
              background: 'none',
              border: 'none',
              padding: '0 2px',
              cursor: 'pointer',
              color: '#64748b',
              fontSize: '11px',
              lineHeight: 1,
              marginTop: '3px',
              fontFamily: 'monospace',
            }}
            title={collapsed ? '展开子属性' : '折叠子属性'}
          >
            {collapsed ? '▶' : '▼'}
          </button>
        ) : (
          <span style={{ display: 'inline-block', width: '12px', color: '#94a3b8', textAlign: 'center' }}>•</span>
        )}

        {/* 字段名 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <code
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#0f172a',
                background: '#f1f5f9',
                padding: '1px 5px',
                borderRadius: '4px',
              }}
            >
              {name}
            </code>

            {/* 类型 Badge */}
            <span
              style={{
                fontSize: '10.5px',
                padding: '1px 6px',
                borderRadius: '4px',
                background:
                  typeDisplay.includes('object')
                    ? '#eff6ff'
                    : typeDisplay.includes('array')
                    ? '#fdf4ff'
                    : typeDisplay === 'string'
                    ? '#f0fdf4'
                    : typeDisplay.includes('number') || typeDisplay.includes('integer')
                    ? '#fffbeb'
                    : '#f8fafc',
                color:
                  typeDisplay.includes('object')
                    ? '#1d4ed8'
                    : typeDisplay.includes('array')
                    ? '#86198f'
                    : typeDisplay === 'string'
                    ? '#15803d'
                    : typeDisplay.includes('number') || typeDisplay.includes('integer')
                    ? '#b45309'
                    : '#475569',
                fontWeight: 600,
              }}
            >
              {typeDisplay}
            </span>

            {/* 必填 Badge */}
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 600,
                color: isRequired ? '#b91c1c' : '#64748b',
                background: isRequired ? '#fef2f2' : '#f1f5f9',
                padding: '1px 5px',
                borderRadius: '4px',
              }}
            >
              {isRequired ? '必填' : '可选'}
            </span>

            {/* 约束规则 */}
            {constraints.length > 0 && (
              <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                ({constraints.join(', ')})
              </span>
            )}
          </div>

          {/* 字段描述 */}
          {description && (
            <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#475569' }}>
              {description}
            </p>
          )}

          {/* 枚举值列表 */}
          {enumVals && enumVals.length > 0 && (
            <div style={{ marginTop: '4px', display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: '#64748b' }}>可选值:</span>
              {enumVals.map((val) => (
                <code
                  key={String(val)}
                  style={{
                    fontSize: '10.5px',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    background: '#f1f5f9',
                    color: '#0f172a',
                  }}
                >
                  {String(val)}
                </code>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 递归展开子对象或数组元素对象 */}
      {hasChildren && !collapsed && (
        <div style={{ marginTop: '2px' }}>
          {childProperties &&
            Object.entries(childProperties).map(([childName, childSchema]) => (
              <PropertyNode
                key={childName}
                name={childName}
                propSchema={isRecord(childSchema) ? childSchema : {}}
                isRequired={childRequired.includes(childName)}
                level={level + 1}
              />
            ))}

          {arrayItemProps &&
            Object.entries(arrayItemProps).map(([childName, childSchema]) => (
              <PropertyNode
                key={childName}
                name={`[item].${childName}`}
                propSchema={isRecord(childSchema) ? childSchema : {}}
                isRequired={arrayItemRequired.includes(childName)}
                level={level + 1}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export function HierarchicalSchemaViewer({ schema, title, defaultExpanded = true }: HierarchicalSchemaViewerProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (!schema || typeof schema !== 'object') {
    return (
      <div style={{ padding: '8px 12px', color: '#94a3b8', fontSize: '12px', fontStyle: 'italic' }}>
        无输入参数或未声明 JSON Schema
      </div>
    );
  }

  const properties = isRecord(schema.properties) ? schema.properties : null;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const propCount = properties ? Object.keys(properties).length : 0;

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '12px 14px',
        marginTop: '8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          paddingBottom: '8px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <strong style={{ fontSize: '13px', color: '#0f172a' }}>
            {title || '输入参数结构化规约'}
          </strong>
          <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: '4px' }}>
            {propCount} 个顶层入参
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowRaw(!showRaw)}
          style={{
            background: 'none',
            border: 'none',
            color: '#2563eb',
            fontSize: '11.5px',
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          {showRaw ? '切换为层级树视图' : '查看原始 JSON Schema'}
        </button>
      </div>

      {showRaw ? (
        <pre
          style={{
            margin: 0,
            padding: '10px',
            background: '#0f172a',
            color: '#e2e8f0',
            fontSize: '11px',
            lineHeight: 1.5,
            borderRadius: '6px',
            maxHeight: '360px',
            overflow: 'auto',
            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
          }}
        >
          {JSON.stringify(schema, null, 2)}
        </pre>
      ) : propCount === 0 ? (
        <div style={{ color: '#64748b', fontSize: '12px', padding: '6px 0' }}>
          无需入参（空参数调用）
        </div>
      ) : (
        <div>
          {Object.entries(properties!).map(([propName, propSchema]) => (
            <PropertyNode
              key={propName}
              name={propName}
              propSchema={isRecord(propSchema) ? propSchema : {}}
              isRequired={required.includes(propName)}
              level={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
