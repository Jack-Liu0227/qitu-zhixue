'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  centerRequest,
  fetchCenterConfig,
  saveCenterConfig,
  type CenterConfig,
} from '../api/knowledge-center';
import { createIdempotentRetryKey } from '../api/types';
const providers = [
  'llamaindex',
  'pageindex-oss',
  'graphrag',
  'lightrag',
  'lightrag-server',
  'pageindex',
  'ima',
  'weknora',
  'obsidian',
  'marginnote',
  'kiwix',
];
export function KnowledgeConfiguration({
  preview = false,
  onMatrix,
}: {
  preview?: boolean;
  onMatrix: () => void;
}) {
  const [snapshot, setSnapshot] = useState<CenterConfig | null>(null);
  const [target, setTarget] = useState('global');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const retry = useRef(createIdempotentRetryKey());
  const load = useCallback(async () => {
    setPending(true);
    setError('');
    try {
      const state = await fetchCenterConfig();
      setSnapshot(state);
      const engine = new URLSearchParams(window.location.search).get('knowledgeEngine');
      if (engine && state.config.knowledgeEngines[engine]) setTarget(`knowledgeEngines/${engine}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      setPending(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!snapshot) return;
    const [section, id] = target.split('/');
    setDraft(
      JSON.stringify(
        target === 'global'
          ? snapshot.config
          : section === 'knowledgeEngines'
            ? snapshot.config.knowledgeEngines[id!]
            : section === 'mcpServers'
              ? snapshot.config.mcpServers[id!]
              : snapshot.config.platformTools['project-knowledge'],
        null,
        2,
      ),
    );
  }, [snapshot, target]);
  async function save() {
    if (!snapshot) return;
    setPending(true);
    setError('');
    try {
      const parsed = JSON.parse(draft);
      const config = structuredClone(snapshot.config);
      if (target === 'global') Object.assign(config, parsed);
      else if (target.startsWith('knowledgeEngines/'))
        config.knowledgeEngines[target.split('/')[1]!] = parsed;
      else if (target.startsWith('mcpServers/')) config.mcpServers[target.split('/')[1]!] = parsed;
      else config.platformTools['project-knowledge'] = parsed;
      const body = { expectedRevision: snapshot.revision, config };
      const state = await saveCenterConfig(body, retry.current.keyFor(JSON.stringify(body)));
      setSnapshot(state);
      retry.current.acknowledge();
      setNotice(`配置已保存，修订 ${state.revision}。连接状态请单独检查。`);
      window.dispatchEvent(new Event('qitu-configuration-changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setPending(false);
    }
  }
  function add() {
    if (!snapshot) return;
    const provider = window.prompt('引擎类型：' + providers.join('、'), 'llamaindex');
    if (!provider || !providers.includes(provider)) return;
    const id = window.prompt('引擎实例 ID（小写字母和连字符）', `${provider}-main`);
    if (!id || !/^[a-z][a-z0-9-]{0,79}$/.test(id) || snapshot.config.knowledgeEngines[id!]) {
      setError('ID 无效或已存在');
      return;
    }
    const next = structuredClone(snapshot);
    next.config.knowledgeEngines[id!] = {
      name: provider,
      description: '',
      provider,
      enabled: false,
      config: {},
    };
    setSnapshot(next);
    setTarget(`knowledgeEngines/${id}`);
    setNotice('已添加到草稿，保存后生效');
  }
  return (
    <section className="admin-settings-page knowledge-config-workbench" aria-label="统一 JSON 配置工作台">
      <div className="settings-pagehead">
        <div>
          <h2>JSON 配置编辑</h2>
          <p>配置修订：{snapshot?.revision ?? '未知'}</p>
        </div>
        <div className="settings-page-actions">
          <button className="settings-action-btn" onClick={onMatrix}>
            返回授权矩阵
          </button>
          <button className="settings-action-btn" onClick={() => void load()} disabled={pending}>
            重新读取
          </button>
          <button className="settings-action-btn" onClick={add} disabled={!snapshot || pending}>
            添加知识引擎
          </button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!snapshot && pending ? (
        <p role="status">正在读取服务器配置…</p>
      ) : snapshot ? (
        <>
          <label>
            配置目标{' '}
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="admin-select"
            >
              <option value="global">全局配置</option>
              <optgroup label="已注册 MCP">
                {Object.entries(snapshot.config.mcpServers).map(([id, s]) => (
                  <option key={id} value={`mcpServers/${id}`}>
                    {String(s.name)} · {id}
                  </option>
                ))}
              </optgroup>
              <optgroup label="知识引擎">
                {Object.entries(snapshot.config.knowledgeEngines).map(([id, e]) => (
                  <option key={id} value={`knowledgeEngines/${id}`}>
                    {e.name} · {id}
                  </option>
                ))}
              </optgroup>
              <optgroup label="项目原生工具">
                <option value="platformTools/project-knowledge">项目知识库检索</option>
              </optgroup>
            </select>
          </label>
          <p>模型引用格式为 providerId:modelId；凭证只使用连接引用。项目检索固定在当前项目范围。</p>
          <textarea
            aria-label="平台 JSON 配置"
            className="admin-prompt-editor-box"
            style={{
              width: '100%',
              minHeight: 400,
              fontFamily: 'monospace',
              boxSizing: 'border-box',
            }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            readOnly={preview}
            spellCheck={false}
          />
          <div className="settings-page-actions">
            <button
              className="settings-action-btn"
              onClick={() => {
                try {
                  setDraft(JSON.stringify(JSON.parse(draft), null, 2));
                  setError('');
                } catch {
                  setError('JSON 格式不正确');
                }
              }}
            >
              格式化
            </button>
            {!preview && (
              <button
                className="settings-action-btn is-primary"
                disabled={pending}
                onClick={() => void save()}
              >
                保存配置
              </button>
            )}
            {target.startsWith('knowledgeEngines/') && (
              <button
                className="settings-action-btn"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    const result = await centerRequest<{ ok: boolean; errorCode?: string }>(
                      `knowledge/engines/${encodeURIComponent(target.split('/')[1]!)}/check`,
                      'POST',
                      {},
                      retry.current.keyFor('check:' + target),
                    );
                    setNotice(result.ok ? '引擎预检通过' : `预检未通过：${result.errorCode}`);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '检查失败');
                  } finally {
                    setPending(false);
                  }
                }}
              >
                检查连接与依赖
              </button>
            )}
          </div>
        </>
      ) : (
        <p>服务器配置未读取，请重试。</p>
      )}
    </section>
  );
}
