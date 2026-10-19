'use client';
// Flow adapted from DeepTutor useImaConnection / ImaConnectionFields (6cf793bd).
import { useEffect, useRef, useState } from 'react';
import { centerRequest, type Engine, type ImaKnowledgeBasePage } from '../../api/knowledge-center';
import { Glyph, message } from './shared';
import styles from './KnowledgeLibrary.module.css';

export function ImaLibraryPicker({
  instanceId,
  engine,
  saved,
  online,
  disabled,
  selectedId,
  onSelect,
  onLoading,
}: {
  instanceId: string;
  engine: Engine;
  saved: boolean;
  online: boolean;
  disabled: boolean;
  selectedId: string;
  onSelect: (id: string, name: string, fromList: boolean) => void;
  onLoading: (loading: boolean) => void;
}) {
  const [page, setPage] = useState<ImaKnowledgeBasePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  const generation = useRef(0);
  const ready = Boolean(
    String(engine.config.clientId ?? '').trim() && String(engine.config.apiKey ?? '').trim(),
  );
  useEffect(
    () => () => {
      generation.current++;
      onLoading(false);
    },
    [onLoading],
  );
  async function load(more = false) {
    const version = ++generation.current;
    setLoading(true);
    onLoading(true);
    setError('');
    if (!more) {
      setPage(null);
      onSelect('', '', false);
    }
    try {
      const next = await centerRequest<ImaKnowledgeBasePage>(
        `knowledge/engines/${encodeURIComponent(instanceId)}/ima-bases`,
        'POST',
        {
          ...(!saved ? { engine: { ...engine, enabled: true } } : {}),
          cursor: more ? (page?.nextCursor ?? '') : '',
          limit: 20,
        },
      );
      if (generation.current !== version) return;
      setPage({
        ...next,
        knowledgeBases: [
          ...new Map(
            [...(more ? (page?.knowledgeBases ?? []) : []), ...next.knowledgeBases].map((item) => [
              item.id,
              item,
            ]),
          ).values(),
        ],
      });
    } catch (e) {
      if (generation.current === version) setError(message(e));
    } finally {
      if (generation.current === version) {
        setLoading(false);
        onLoading(false);
      }
    }
  }
  return (
    <section className={styles.defaultConfig} aria-label="ima 知识库选择">
      <div className={styles.split}>
        <strong>选择 ima 知识库</strong>
        <button
          type="button"
          className={styles.textButton}
          disabled={disabled || loading}
          onClick={() => {
            setManual(!manual);
            onSelect('', '', false);
            setError('');
          }}
        >
          {manual ? '从列表选择' : '手动填写 ID'}
        </button>
      </div>
      <p>验证 Client ID 和 API Key 后，选择此账户可访问的知识库。</p>
      {!ready && <p>请先在上方填写完整的 Client ID 和 API Key。</p>}
      {!manual ? (
        <>
          <button
            type="button"
            className={`${styles.secondary} ${styles.connectionButton}`}
            disabled={disabled || loading || !online || !ready}
            onClick={() => void load()}
          >
            <Glyph name={loading ? 'refresh' : 'search'} size={16} />
            {loading ? '正在读取…' : '验证凭证并读取知识库'}
          </button>
          {page && (
            <p role="status">
              凭证验证通过，已读取 {page.knowledgeBases.length} 个可访问的知识库。
              {!saved ? '关联前请保存上方引擎配置。' : ''}
            </p>
          )}
          {page?.knowledgeBases.length === 0 && (
            <p>此账户暂无可访问的知识库，请在 ima 中确认库的归属和 OpenAPI 授权后重试。</p>
          )}
          {!!page?.knowledgeBases.length && (
            <div className={styles.imaList} role="radiogroup" aria-label="可关联的 ima 知识库">
              {page.knowledgeBases.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedId === item.id}
                  disabled={disabled || loading}
                  className={`${styles.imaOption} ${selectedId === item.id ? styles.selected : ''}`}
                  onClick={() => onSelect(item.id, item.name, true)}
                >
                  <span>
                    <strong>{item.name}</strong>
                  </span>
                  {selectedId === item.id && <Glyph name="check" />}
                </button>
              ))}
            </div>
          )}
          {page && !page.isEnd && (
            <button
              type="button"
              className={styles.textButton}
              disabled={disabled || loading || !online || !page.nextCursor}
              onClick={() => void load(true)}
            >
              加载更多知识库
            </button>
          )}
        </>
      ) : (
        <label className={styles.field}>
          ima OpenAPI 知识库 ID
          <input
            value={selectedId}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => onSelect(e.target.value.trim(), '', false)}
            placeholder="填写 OpenAPI 返回的知识库 ID"
          />
          <small>
            不是 Client ID，也不是 ima 客户端地址里的内部 ID。手动填写后请点击下方“检查连接”。
          </small>
        </label>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
