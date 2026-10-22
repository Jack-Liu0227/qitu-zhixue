'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AssistantGlyph } from '@qitu/ui';
import type { KnowledgeBindingMatrix as Matrix, KnowledgeMatrixPatch } from '@qitu/contracts';
import {
  fetchKnowledgeMatrix,
  patchKnowledgeMatrix,
  setKnowledgeRetrieval,
} from '../../api/knowledge-center';
import { createIdempotentRetryKey, newIdempotencyKey } from '../../api/types';
import { Glyph, message } from './shared';
import styles from './KnowledgeMatrix.module.css';

type Draft = { knowledgeBaseId: string; assistantId: string; enabled: boolean; revision: number };
const cellKey = (library: string, assistant: string) => JSON.stringify([library, assistant]);
const bound = (data: Matrix, library: string, assistant: string) =>
  data.bindings.find((b) => b.knowledgeBaseId === library && b.assistantId === assistant)
    ?.enabled ?? false;

export function KnowledgeBindingMatrix({
  online,
  refreshToken,
  focusLibraryId,
  onRead,
}: {
  online: boolean;
  refreshToken: number;
  focusLibraryId: string | null;
  onRead: (data: Matrix) => void;
}) {
  const [data, setData] = useState<Matrix | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [mobileAssistant, setMobileAssistant] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const sequence = useRef(0);
  const pending = useRef<{ body: KnowledgeMatrixPatch; key: string } | null>(null);
  const switchKey = useRef(createIdempotentRetryKey());
  const readCallback = useRef(onRead);
  readCallback.current = onRead;

  const read = useCallback(async (rebase = false) => {
    const token = ++sequence.current;
    setLoading(true);
    try {
      const next = await fetchKnowledgeMatrix();
      if (token !== sequence.current) return null;
      setData(next);
      readCallback.current(next);
      if (rebase)
        setDrafts((current) =>
          Object.fromEntries(
            Object.entries(current).map(([key, draft]) => [
              key,
              {
                ...draft,
                revision:
                  next.libraries.find((l) => l.id === draft.knowledgeBaseId)?.revision ??
                  draft.revision,
              },
            ]),
          ),
        );
      setError('');
      return next;
    } catch (e) {
      if (token === sequence.current) setError(message(e));
      throw e;
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void read().catch(() => {});
    return () => {
      sequence.current++;
    };
  }, [read, refreshToken]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(drafts).length || uncertain) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts, uncertain]);

  const dirty = Object.values(drafts);
  const editable = !!data?.complete && !loading && !saving && !uncertain && online;
  const assistants =
    data?.assistants.filter((a) => a.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  const libraries =
    data?.libraries.filter((l) => l.name.toLowerCase().includes(libraryQuery.toLowerCase())) ?? [];

  function change(pairs: { library: string; assistant: string; enabled: boolean }[]) {
    if (!data || !editable) return;
    setNotice('');
    setDrafts((current) => {
      const next = { ...current };
      for (const pair of pairs) {
        const assistant = data.assistants.find((a) => a.id === pair.assistant);
        const library = data.libraries.find((l) => l.id === pair.library);
        if (!library || !assistant || (pair.enabled && !assistant.enabled)) continue;
        const key = cellKey(pair.library, pair.assistant);
        if (bound(data, pair.library, pair.assistant) === pair.enabled) delete next[key];
        else
          next[key] = {
            knowledgeBaseId: pair.library,
            assistantId: pair.assistant,
            enabled: pair.enabled,
            revision:
              Object.values(current).find((d) => d.knowledgeBaseId === pair.library)?.revision ??
              library.revision,
          };
      }
      return next;
    });
  }

  async function save() {
    if (!data || !online || saving || loading) return;
    setSaving(true);
    setError('');
    setNotice('');
    if (!pending.current) {
      const changes = data.libraries.flatMap((library) => {
        const edits = dirty.filter((d) => d.knowledgeBaseId === library.id);
        return edits.length
          ? [
              {
                knowledgeBaseId: library.id,
                expectedRevision: edits[0]!.revision,
                bindings: edits.map(({ assistantId, enabled }) => ({ assistantId, enabled })),
              },
            ]
          : [];
      });
      if (!changes.length) {
        setSaving(false);
        return;
      }
      pending.current = { body: { changes }, key: newIdempotencyKey() };
    }
    const request = pending.current;
    try {
      const receipt = await patchKnowledgeMatrix(request.body, request.key);
      setUncertain(true);
      const current = await read();
      if (!current) throw new Error('回读已被新请求替代，请重试核验');
      const confirmed: string[] = [];
      const failures: string[] = [];
      for (const result of receipt.results) {
        const group = request.body.changes.find(
          (c) => c.knowledgeBaseId === result.knowledgeBaseId,
        );
        const title =
          current.libraries.find((l) => l.id === result.knowledgeBaseId)?.name ??
          result.knowledgeBaseId;
        if (result.status === 'failed') {
          failures.push(`${title}：${result.message}`);
          continue;
        }
        if (!group) continue;
        for (const cell of group.bindings) {
          if (bound(current, result.knowledgeBaseId, cell.assistantId) === cell.enabled)
            confirmed.push(cellKey(result.knowledgeBaseId, cell.assistantId));
          else failures.push(`${title}：回读与提交状态不同，请核对最新修改`);
        }
      }
      setDrafts((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([key]) => !confirmed.includes(key))),
      );
      pending.current = null;
      setUncertain(false);
      setNotice(
        `已回读确认 ${confirmed.length} 项绑定${failures.length ? '，其余修改保留在草稿中' : ''}。`,
      );
      setError(failures.join('；'));
    } catch (e) {
      setUncertain(true);
      setError(`提交状态待确认：${message(e)}。点击“重试核验”，将使用原请求核对。`);
    } finally {
      setSaving(false);
    }
  }

  function checkbox(libraryId: string, assistantId: string) {
    if (!data) return null;
    const library = data.libraries.find((l) => l.id === libraryId)!;
    const assistant = data.assistants.find((a) => a.id === assistantId)!;
    const draft = drafts[cellKey(libraryId, assistantId)];
    const checked = draft?.enabled ?? bound(data, libraryId, assistantId);
    const reasons = [
      ...library.reasons,
      ...(!assistant.enabled ? ['助手已停用'] : []),
      ...(!data.retrievalEnabled ? ['检索总开关关闭'] : []),
      ...(!assistant.retrievalAllowed && !draft?.enabled ? ['助手检索能力未授权'] : []),
    ];
    const label = draft
      ? '待保存'
      : !checked
        ? '未绑定'
        : reasons.length
          ? '已绑定，暂不可用'
          : '已绑定';
    return (
      <label className={`${styles.cell} ${draft ? styles.draft : ''}`} title={reasons.join('，')}>
        <input
          type="checkbox"
          aria-label={`${assistant.name} / ${library.name}`}
          checked={checked}
          disabled={!editable || (!assistant.enabled && !checked)}
          onChange={(e) =>
            change([{ library: libraryId, assistant: assistantId, enabled: e.target.checked }])
          }
        />
        <span>{label}</span>
        {checked && reasons.length > 0 && <small>{reasons.join('，')}</small>}
      </label>
    );
  }

  return (
    <section
      id="knowledge-binding-matrix"
      className={styles.root}
      aria-label="助手知识库绑定矩阵"
      aria-busy={loading || saving}
    >
      <header className={styles.header}>
        <div>
          <h2>
            <Glyph name="assistant" />
            助手绑定知识库
          </h2>
          <p>勾选助手可使用的知识库。正式项目仍按已确认的教材范围执行。</p>
        </div>
        <button
          disabled={!online || !data || saving || uncertain || loading}
          onClick={async () => {
            if (!data) return;
            setSaving(true);
            setError('');
            try {
              const signature = `${data.configurationRevision}:${!data.retrievalEnabled}`;
              await setKnowledgeRetrieval(
                data.configurationRevision,
                !data.retrievalEnabled,
                switchKey.current.keyFor(signature),
              );
              await read();
              switchKey.current.acknowledge();
            } catch (e) {
              setError(message(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          知识检索：{data ? (data.retrievalEnabled ? '已开启' : '已关闭') : '读取中'}
        </button>
      </header>
      <div className={styles.toolbar}>
        <input
          aria-label="搜索助手"
          placeholder="搜索助手"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={saving}
        />
        <input
          aria-label="搜索矩阵知识库"
          placeholder="搜索知识库"
          value={libraryQuery}
          onChange={(e) => setLibraryQuery(e.target.value)}
          disabled={saving}
        />
        <button
          disabled={!online || saving || uncertain}
          onClick={() =>
            void read(true)
              .then(() => setNotice('已读取最新配置，草稿已保留，请核对后保存。'))
              .catch(() => {})
          }
        >
          重新读取
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {!online && <p className={styles.error}>当前离线，已保留本次会话草稿。</p>}
      {data && !data.complete && (
        <p className={styles.error}>目录未完整读取，绑定编辑已暂停，请缩小配置范围后重试。</p>
      )}
      {loading && <p role="status">正在读取助手与知识库绑定…</p>}
      {!loading && !data && <p>矩阵尚未读取成功，请重新读取。</p>}
      {data && (!data.assistants.length || !data.libraries.length) && (
        <p>先配置知识库和 AI 助手，即可在此绑定。</p>
      )}
      {data && data.assistants.length > 0 && data.libraries.length > 0 && (
        <>
          <div className={styles.desktop}>
            <table>
              <caption>单格修改或按行列批量选择，仅影响当前展示范围</caption>
              <thead>
                <tr>
                  <th>AI 助手</th>
                  {libraries.map((l) => (
                    <th key={l.id} className={l.id === focusLibraryId ? styles.focus : ''}>
                      <strong>{l.name}</strong>
                      <div className={styles.bulk}>
                        <button
                          disabled={!editable}
                          onClick={() =>
                            change(
                              assistants.map((a) => ({
                                library: l.id,
                                assistant: a.id,
                                enabled: true,
                              })),
                            )
                          }
                        >
                          选择本列
                        </button>
                        <button
                          disabled={!editable}
                          onClick={() =>
                            change(
                              assistants.map((a) => ({
                                library: l.id,
                                assistant: a.id,
                                enabled: false,
                              })),
                            )
                          }
                        >
                          清除本列
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assistants.map((a) => (
                  <tr key={a.id}>
                    <th>
                      <span>
                        <AssistantGlyph value={a.avatar} size={22} />
                        {a.name}
                      </span>
                      {!a.enabled && <small>已停用</small>}
                      <div className={styles.bulk}>
                        <button
                          disabled={!editable || !a.enabled}
                          onClick={() =>
                            change(
                              libraries.map((l) => ({
                                library: l.id,
                                assistant: a.id,
                                enabled: true,
                              })),
                            )
                          }
                        >
                          选择本行
                        </button>
                        <button
                          disabled={!editable}
                          onClick={() =>
                            change(
                              libraries.map((l) => ({
                                library: l.id,
                                assistant: a.id,
                                enabled: false,
                              })),
                            )
                          }
                        >
                          清除本行
                        </button>
                      </div>
                    </th>
                    {libraries.map((l) => (
                      <td key={l.id} className={l.id === focusLibraryId ? styles.focus : ''}>
                        {checkbox(l.id, a.id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.mobile}>
            <label>
              选择助手
              <select
                aria-label="手机端选择助手"
                value={mobileAssistant || assistants[0]?.id || ''}
                onChange={(e) => setMobileAssistant(e.target.value)}
              >
                {assistants.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.enabled ? '' : '（已停用）'}
                  </option>
                ))}
              </select>
            </label>
            {libraries.map((l) => {
              const assistant = assistants.find((a) => a.id === mobileAssistant) ?? assistants[0];
              return assistant ? (
                <div key={l.id} className={styles.mobileRow}>
                  <strong>{l.name}</strong>
                  {checkbox(l.id, assistant.id)}
                </div>
              ) : null;
            })}
          </div>
          {(!assistants.length || !libraries.length) && <p>没有匹配的助手或知识库。</p>}
        </>
      )}
      <footer className={styles.footer}>
        <span>
          {dirty.length} 项待保存{uncertain ? ' · 提交待核验' : ''}
        </span>
        <button
          disabled={!dirty.length || saving || uncertain}
          onClick={() => {
            setDrafts({});
            setNotice('草稿已放弃');
          }}
        >
          放弃草稿
        </button>
        <button
          className={styles.primary}
          disabled={
            !online || saving || loading || (!uncertain && (!dirty.length || !data?.complete))
          }
          onClick={() => void save()}
        >
          {saving ? '正在保存与核验…' : uncertain ? '重试核验' : '保存变更'}
        </button>
      </footer>
    </section>
  );
}
