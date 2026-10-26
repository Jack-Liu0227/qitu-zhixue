'use client';
import type { ToolCatalog } from '../api/knowledge-center';
import { HierarchicalSchemaViewer } from './HierarchicalSchemaViewer';
import styles from './KnowledgeConfiguration.module.css';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Render schemas as data, without resolving remote references. */
export function ToolParameters({
  catalog,
  pending,
  error,
  onRefresh,
}: {
  catalog?: ToolCatalog;
  pending?: boolean;
  error?: string;
  onRefresh: () => void;
}) {
  return (
    <div className={styles.toolList}>
      <div className={styles.toolHeading}>
        <span>子工具与输入参数</span>
        <button type="button" className={styles.link} onClick={onRefresh} disabled={pending}>
          刷新目录
        </button>
      </div>
      {pending && <p role="status">正在读取工具定义…</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {catalog && (
        <>
          {catalog.message && (
            <p
              className={
                catalog.stale || catalog.source === 'legacy_manifest' ? styles.warning : styles.hint
              }
            >
              {catalog.message}
            </p>
          )}
          {catalog.fetchedAt && (
            <small>
              {catalog.stale ? '已过期 · ' : ''}获取于{' '}
              {new Date(catalog.fetchedAt).toLocaleString()}
            </small>
          )}
          {!catalog.tools.length && <p className={styles.hint}>没有独立子工具。</p>}
          {catalog.tools.map((tool) => {
            const schema = tool.inputSchema;
            const properties = schema && record(schema.properties) ? schema.properties : {};
            const required = schema && Array.isArray(schema.required) ? schema.required : [];
            return (
              <details className={styles.tool} key={tool.name}>
                <summary>{tool.name}</summary>
                {tool.description && <p>{tool.description}</p>}
                {schema ? (
                  <HierarchicalSchemaViewer
                    schema={schema as Record<string, unknown>}
                    title={tool.name + ' 输入参数层级透视'}
                  />
                ) : (
                  <p className={styles.warning}>
                    参数定义暂不可用；服务未返回可验证的 inputSchema。
                  </p>
                )}
              </details>
            );
          })}
        </>
      )}
    </div>
  );
}
