'use client';

import { AssistantGlyph } from '@qitu/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchBaseBindings,
  saveBaseBindings,
  type Base,
  type KnowledgeBinding,
} from '../../api/knowledge-center';
import { createIdempotentRetryKey } from '../../api/types';
import { Glyph, message } from './shared';
import styles from './KnowledgeLibrary.module.css';

export function LibraryAssistantBindings({
  base,
  online,
  onBusyChange,
  onSaved,
}: {
  base: Base;
  online: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [bindings, setBindings] = useState<KnowledgeBinding[]>([]);
  const [revision, setRevision] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useRef(createIdempotentRetryKey());
  const read = useCallback(async () => {
    const data = await fetchBaseBindings(base.id);
    return { rows: data.catalog ?? data.bindings, revision: data.bindingRevision };
  }, [base.id]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void read()
      .then(
        (data) => {
          if (!active) return;
          setBindings(data.rows);
          setRevision(data.revision);
          setDirty(false);
        },
        (e: unknown) => {
          if (active) setError(message(e));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [read, attempt]);
  async function save() {
    setSaving(true);
    onBusyChange(true);
    setError('');
    setNotice('');
    try {
      const payload = bindings.map(({ agentKind, agentId, mode, enabled }) => ({
        agentKind,
        agentId,
        mode,
        enabled,
      }));
      const result = await saveBaseBindings(
        base.id,
        { expectedRevision: revision, bindings: payload },
        retry.current.keyFor(base.id + ':' + JSON.stringify(payload)),
      );
      retry.current.acknowledge();
      setBindings(
        (rows) =>
          result.catalog ??
          rows.map((row) => ({
            ...row,
            ...result.bindings.find(
              (saved) => saved.agentKind === row.agentKind && saved.agentId === row.agentId,
            ),
          })),
      );
      setRevision(result.bindingRevision);
      setDirty(false);
      setNotice('助手绑定已保存；检索仍遵守工具总开关和助手启用状态。');
      await onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }
  const assistants = bindings.filter((b) => b.agentKind === 'admin_assistant');
  return (
    <section className={styles.globalBindings} aria-label="检索助手绑定" aria-busy={loading}>
      <div className={styles.split}>
        <h2 className={styles.bindingTitle}>
          <Glyph name="assistant" /> 检索助手绑定
        </h2>
        <span className={styles.badge}>{base.name}</span>
      </div>
      <p>
        当前知识库：{base.name}
        。已勾选的助手与此库绑定，可直接勾选或取消后保存。切换知识库会放弃未保存的勾选。
      </p>
      {loading ? (
        <p role="status">正在读取此知识库的助手绑定…</p>
      ) : (
        <>
          {error && (
            <div className={styles.error} role="alert">
              {error}
              <button
                className={styles.textButton}
                disabled={saving || !online}
                onClick={() => {
                  setNotice('');
                  setAttempt((n) => n + 1);
                }}
              >
                重新读取
              </button>
            </div>
          )}
          {notice && (
            <div className={styles.notice} role="status">
              {notice}
            </div>
          )}
          {assistants.length === 0 ? (
            <p>暂无可绑定的 AI 助手。</p>
          ) : (
            <div className={styles.assistantGrid}>
              {assistants.map((binding) => (
                <label
                  key={binding.agentId}
                  className={`${styles.assistantCard} ${binding.enabled ? styles.selected : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={binding.enabled}
                    disabled={
                      saving || !online || (binding.targetEnabled === false && !binding.enabled)
                    }
                    onChange={(event) => {
                      setBindings((rows) =>
                        rows.map((row) =>
                          row.agentId === binding.agentId && row.agentKind === binding.agentKind
                            ? { ...row, enabled: event.target.checked }
                            : row,
                        ),
                      );
                      setDirty(true);
                      setNotice('');
                    }}
                  />
                  <span>
                    <strong>
                      <AssistantGlyph value={binding.avatar} size={20} /> {binding.agentName ?? binding.agentId}
                    </strong>
                    <small>
                      {binding.targetEnabled === false
                        ? '助手已停用'
                        : binding.enabled
                          ? '已勾选绑定'
                          : '未绑定'}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className={styles.bindingActions}>
            <span>
              {dirty
                ? '有未保存的更改'
                : `已绑定 ${assistants.filter((b) => b.enabled).length} 位 AI 助手`}
            </span>
            <button
              className={styles.primary}
              disabled={saving || loading || !online || !dirty || revision === undefined}
              onClick={() => void save()}
            >
              {saving ? '正在保存…' : '保存助手绑定'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
