'use client';
import type { ToolCatalog } from '../api/knowledge-center';
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
            <p className={catalog.stale ? styles.warning : styles.hint}>{catalog.message}</p>
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
                  <>
                    {Object.keys(properties).length > 0 && (
                      <div className={styles.parameterScroll}>
                        <table className={styles.parameters}>
                          <thead>
                            <tr>
                              <th>参数 / 类型</th>
                              <th>必填</th>
                              <th>说明与约束</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(properties).map(([name, raw]) => {
                              const value = record(raw) ? raw : {};
                              const { type, description, ...constraints } = value;
                              return (
                                <tr key={name}>
                                  <td>
                                    <code>{name}</code>
                                    <small>
                                      {Array.isArray(type)
                                        ? type.join(' | ')
                                        : String(type ?? '见 schema')}
                                    </small>
                                  </td>
                                  <td>{required.includes(name) ? '是' : '否'}</td>
                                  <td>
                                    {typeof description === 'string' && <span>{description}</span>}
                                    {Object.keys(constraints).length > 0 && (
                                      <pre>{JSON.stringify(constraints, null, 2)}</pre>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <details className={styles.schema} open>
                      <summary>完整 inputSchema（只读）</summary>
                      <pre>{JSON.stringify(schema, null, 2)}</pre>
                    </details>
                  </>
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
