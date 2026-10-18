'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  centerRequest,
  type Engine,
  type EngineCheck,
  type EngineField,
  type EngineGroup,
} from '../../api/knowledge-center';
import styles from './RemoteEngineSettings.module.css';

const descriptions: Record<
  string,
  { intro: string; preparation: string; credentials: string; url?: string }
> = {
  'lightrag-server': {
    intro: '连接你部署的独立 LightRAG 服务，通过 HTTP 检索远端知识图谱与向量索引。',
    preparation:
      '先部署 LightRAG Server，并确认启途服务器能够访问。此处保存可复用的默认连接；连接具体知识库时可覆盖服务地址。',
    credentials: '新连接的知识库使用此引擎实例的配置。API Key 仅在远端服务开启认证时填写。',
  },
  pageindex: {
    intro: '托管的无向量知识引擎。通过 PageIndex SDK 工具读取文档，使用模型推理定位相关内容。',
    preparation:
      '需要 PageIndex API Key 和已配置的推理读取模型。云端处理 PDF、Office、文本和 Markdown 文档，文件会上传至 PageIndex。',
    credentials: 'API Key 由此 PageIndex Cloud 引擎实例使用，可在此直接查看、修改并保存。',
    url: 'https://dash.pageindex.ai/',
  },
  ima: {
    intro: '连接存放在腾讯 ima 的知识库，检索资料、浏览文档与读取原文，资料继续由 ima 管理。',
    preparation:
      '需要 ima Client ID 和 API Key，也可沿用已部署的 ima MCP 桥接。文件上传和资料整理仍在 ima 中完成。',
    credentials:
      '一组账户凭证可访问该账户获授权的知识库。保存到此 ima 引擎实例，再为各知识库指定远端库 ID。',
    url: 'https://ima.qq.com/agent-interface',
  },
  weknora: {
    intro: '连接自托管的腾讯 WeKnora，通过 REST API 检索已有知识库，文件与索引保留在 WeKnora。',
    preparation:
      '先部署 WeKnora，创建知识库并完成索引。提供服务地址、API Key 和可选的默认知识库 ID；连接时会核验目标库访问权限。',
    credentials:
      'API Key 须拥有目标知识库的访问权限。服务地址变更时需重新填写密钥，防止将原凭证发送到其他服务。',
    url: 'https://github.com/Tencent/WeKnora',
  },
};
const modes = [
  ['naive', '向量检索', '仅检索向量索引，适合直接查找相似内容。'],
  ['local', '局部图谱', '聚焦相关实体及其相邻关系。'],
  ['global', '全局图谱', '基于全局关系，查找跨文档的主题信息。'],
  ['hybrid', '混合检索', '结合局部实体与全局关系检索。'],
  ['mix', '图谱与向量融合', '融合知识图谱与向量检索，LightRAG Server 默认模式。'],
];
function SectionIcon({ kind }: { kind: 'shield' | 'key' | 'database' | 'settings' | 'workflow' }) {
  const paths = {
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3ZM9 12l2 2 4-4',
    key: 'M14 4a6 6 0 0 0-5 9l-6 6v3h3v-3h3l3-3a6 6 0 1 0 2-12Zm3 4h.01',
    database:
      'M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3ZM4 6v6c0 2 4 3 8 3s8-1 8-3V6M4 12v6c0 2 4 3 8 3s8-1 8-3v-6',
    settings: 'M4 7h16M4 17h16M8 3v8M16 13v8',
    workflow: 'M4 3h6v6H4zM14 15h6v6h-6zM7 9v9h7M14 3h6v6h-6zM10 6h4',
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

export function RemoteEngineSettings({
  group,
  draft,
  instanceId,
  dirty,
  busy,
  online,
  check,
  onChange,
  onSave,
  onInspect,
  onChanged,
  onOpenBase,
  renderField,
}: {
  group: EngineGroup;
  draft: Engine;
  instanceId: string;
  dirty: boolean;
  busy: boolean;
  online: boolean;
  check: EngineCheck | null;
  onChange: (value: Engine) => void;
  onSave: () => Promise<boolean>;
  onInspect: () => Promise<void>;
  onChanged: () => Promise<void>;
  onOpenBase: (id: string) => void | Promise<void>;
  renderField: (field: EngineField) => React.ReactNode;
}) {
  const copy = descriptions[group.provider]!;
  const instance = group.instances.find((i) => i.id === instanceId);
  const apiKey = String(draft.config.apiKey ?? '');
  const clientId = String(draft.config.clientId ?? '');
  const [showKey, setShowKey] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [probe, setProbe] = useState<{ fingerprint: string; receipt: EngineCheck } | null>(null);
  const setApiKey = (value: string) =>
    onChange({ ...draft, config: { ...draft.config, apiKey: value } });
  const setClientId = (value: string) =>
    onChange({ ...draft, config: { ...draft.config, clientId: value } });
  const isServer = ['lightrag-server', 'weknora'].includes(group.provider);
  const serverUrl = String(
    draft.config.server_url ??
      (group.provider === 'ima'
        ? 'https://ima.qq.com'
        : group.provider === 'pageindex'
          ? 'https://api.pageindex.ai'
          : ''),
  )
    .trim()
    .replace(/\/+$/, '');
  const fingerprint = JSON.stringify(draft);
  const receipt = probe?.fingerprint === fingerprint ? probe.receipt : null;
  const changed = dirty || !instance;
  const disabled = busy || working || !online;
  const keyAvailable = !!apiKey;
  const legacyBridge = group.provider === 'ima' && !apiKey && !clientId;
  const canTest =
    (!isServer || !!serverUrl) &&
    (group.provider === 'lightrag-server' || legacyBridge || keyAvailable) &&
    (group.provider !== 'ima' || !!clientId || legacyBridge);
  const test = async () => {
    setWorking(true);
    setError('');
    setNotice('');
    setProbe(null);
    try {
      const value = await centerRequest<EngineCheck>(
        `knowledge/engines/${encodeURIComponent(instanceId)}/probe`,
        'POST',
        { engine: draft },
      );
      setProbe({ fingerprint, receipt: value });
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接测试失败，请重试');
    } finally {
      setWorking(false);
    }
  };
  const save = async () => {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      if (await onSave()) {
        setProbe(null);
        setNotice('配置已保存，网页表单与 JSON 配置已同步。请检查环境与连接。');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      setWorking(false);
    }
  };
  const selectedMode = String(draft.config.mode ?? 'mix');
  return (
    <div className={styles.root}>
      <p className={styles.intro}>{copy.intro}</p>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className={styles.success}>
          {notice}
        </div>
      )}
      {!online && (
        <div role="alert" className={styles.error}>
          当前已离线，恢复连接后可保存和测试配置。
        </div>
      )}
      <section className={styles.section}>
        <details open className={styles.environment}>
          <summary>
            <span>
              <SectionIcon kind="shield" />
              环境要求
            </span>
            <span className={styles.chevron}>⌄</span>
          </summary>
          <div className={styles.card}>
            <p>{copy.preparation}</p>
            <div className={styles.actions}>
              <button onClick={() => void onInspect()} disabled={disabled || changed || !instance}>
                ↻ {busy ? '检查中…' : '检查环境'}
              </button>
              <span>
                {changed
                  ? '保存当前配置后可检查环境'
                  : instance?.health?.checked_at
                    ? `上次检查 ${new Date(instance.health.checked_at).toLocaleString('zh-CN')}`
                    : '尚未检查当前配置'}
              </span>
            </div>
            {check && !changed && (
              <div className={styles.checks} role="status">
                <strong className={check.ok ? styles.goodText : styles.warnText}>
                  {check.ok ? '✓ 环境与连接检查通过' : '环境与连接尚未就绪'}
                </strong>
                {check.checks?.map((item) => (
                  <div key={item.key}>
                    <span className={item.ok ? styles.goodText : styles.warnText}>
                      {item.ok ? '✓' : '!'}
                    </span>
                    <p>
                      <strong>
                        {item.label}
                        {item.optional ? ' · 可选' : ''}
                      </strong>
                      <small>{item.detail}</small>
                    </p>
                  </div>
                ))}
                {check.errorCode && <small>{check.errorCode}</small>}
              </div>
            )}
          </div>
        </details>
      </section>
      <section className={styles.section} aria-labelledby="remote-credentials-title">
        <h3 id="remote-credentials-title">
          <SectionIcon kind={isServer ? 'settings' : 'key'} />
          {isServer ? '默认连接配置' : '账户凭证'}
          <span className={styles.credentialBadge}>
            {apiKey ? '密钥已配置' : legacyBridge ? '可沿用 MCP 桥接' : '待配置'}
          </span>
        </h3>
        <div className={styles.card}>
          <p>{copy.credentials}</p>
          <div className={styles.fields}>
            {
              <label htmlFor="remote-server-url">
                服务器地址
                <input
                  id="remote-server-url"
                  type="url"
                  readOnly={!isServer}
                  value={isServer ? String(draft.config.server_url ?? '') : serverUrl}
                  placeholder={
                    group.provider === 'weknora'
                      ? 'https://weknora.example.com'
                      : 'http://localhost:9621'
                  }
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      config: { ...draft.config, server_url: e.target.value, apiKey: '' },
                    })
                  }
                  disabled={disabled}
                />
              </label>
            }
            {group.provider === 'ima' && (
              <label htmlFor="remote-client-id">
                CLIENT ID
                <input
                  id="remote-client-id"
                  value={clientId}
                  placeholder="输入你的 ima Client ID"
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                  disabled={disabled}
                />
              </label>
            )}
            <label htmlFor="remote-api-key">
              API KEY{group.provider === 'lightrag-server' && <span> · 可选</span>}
              <div className={styles.secretInput}>
                <input
                  id="remote-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    group.provider === 'lightrag-server'
                      ? '仅当服务器开启认证时填写'
                      : '输入 API Key'
                  }
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={disabled}
                />
                <button
                  type="button"
                  aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setShowKey((v) => !v)}
                  disabled={disabled}
                >
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
            </label>
            {group.provider === 'weknora' && (
              <label htmlFor="remote-kb-id">
                默认知识库 ID · 可选
                <input
                  id="remote-kb-id"
                  value={String(draft.config.remoteKnowledgeBaseId ?? '')}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      config: { ...draft.config, remoteKnowledgeBaseId: e.target.value },
                    })
                  }
                  placeholder="连接具体知识库时也可指定"
                  disabled={disabled}
                />
              </label>
            )}
          </div>
          {receipt && (
            <div className={receipt.ok ? styles.success : styles.error} role="status">
              <strong>{receipt.ok ? '✓ 连接测试通过' : '连接测试未通过'}</strong>
              <p>
                {receipt.ok
                  ? '当前填写的连接与凭证已通过检查；保存后生效。'
                  : (receipt.checks?.find((c) => !c.ok && !c.optional)?.detail ??
                    '请检查地址、凭证、模型配置和服务可达性。')}
              </p>
              {receipt.errorCode && <small>{receipt.errorCode}</small>}
            </div>
          )}
          <div className={styles.formFooter}>
            <div>
              {copy.url ? (
                <a href={copy.url} target="_blank" rel="noreferrer">
                  {group.provider === 'weknora' ? 'WeKnora 部署文档' : '获取 API 密钥'} ↗
                </a>
              ) : (
                <span>URL、ID 与 API Key 均可在 JSON 配置中编辑。</span>
              )}
            </div>
            <div className={styles.actions}>
              <button onClick={() => void test()} disabled={disabled || !canTest}>
                {working ? '处理中…' : '测试连接'}
              </button>
              <button
                className={styles.primary}
                onClick={() => void save()}
                disabled={disabled || !changed}
              >
                {working ? '处理中…' : isServer ? '保存默认配置' : '保存更改'}
              </button>
            </div>
          </div>
          <small className={styles.footnote}>
            管理员可直接查看和修改已保存的密钥。连接测试使用当前填写内容，不会自动保存。
          </small>
        </div>
      </section>
      {group.provider === 'lightrag-server' && (
        <section className={styles.section} aria-labelledby="remote-modes-title">
          <h3 id="remote-modes-title">
            <SectionIcon kind="workflow" />
            检索模式
          </h3>
          <p className={styles.sectionHint}>
            设置此引擎实例的默认模式，单个知识库可覆盖。修改后点击“保存默认配置”。
          </p>
          <div className={styles.modeGrid} role="radiogroup" aria-label="默认检索模式">
            {modes.map(([value, label, description]) => (
              <button
                role="radio"
                aria-checked={selectedMode === value}
                key={value}
                className={`${styles.modeCard} ${selectedMode === value ? styles.selected : ''}`}
                onClick={() => onChange({ ...draft, config: { ...draft.config, mode: value } })}
                disabled={disabled}
              >
                <div>
                  <code>{value}</code>
                  <span>{selectedMode === value ? '✓' : ''}</span>
                </div>
                <strong>{label}</strong>
                <p>{description}</p>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className={styles.section}>
        <details className={styles.advanced}>
          <summary>
            <span>
              <SectionIcon kind="settings" />
              实例与高级设置
            </span>
            <span className={styles.chevron}>⌄</span>
          </summary>
          <div className={styles.card}>
            <div className={styles.fields}>
              <label htmlFor="remote-instance-id">
                实例 ID
                <input id="remote-instance-id" value={instanceId} readOnly />
              </label>
              <label htmlFor="remote-instance-name">
                显示名称
                <input
                  id="remote-instance-name"
                  value={draft.name}
                  onChange={(e) => onChange({ ...draft, name: e.target.value })}
                  disabled={disabled}
                />
              </label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
                  disabled={disabled}
                />
                启用此引擎<span>启用状态与连接状态分别检查</span>
              </label>
              {(group.definition?.fields ?? [])
                .filter(
                  (f) =>
                    ![
                      'server_url',
                      'remoteKnowledgeBaseId',
                      'mode',
                      'connectionRef',
                      'allowMaterialize',
                      'apiKey',
                      'clientId',
                    ].includes(f.key),
                )
                .map(renderField)}
            </div>
            <div className={styles.formFooter}>
              <Link href={`/settings/tools?knowledgeEngine=${encodeURIComponent(instanceId)}`}>
                前往 JSON 配置 ↗
              </Link>
              <button
                className={styles.primary}
                onClick={() => void save()}
                disabled={disabled || !changed}
              >
                保存更改
              </button>
            </div>
          </div>
        </details>
      </section>
      <section className={styles.section} aria-labelledby="remote-bases-title">
        <h3 id="remote-bases-title">
          <SectionIcon kind="database" />
          知识库<span className={styles.baseCount}>{instance?.associatedBases.length ?? 0}</span>
        </h3>
        {instance?.associatedBases.length ? (
          <div className={styles.baseList}>
            {instance.associatedBases.map((base) => (
              <button key={base.id} onClick={() => void onOpenBase(base.id)}>
                <span className={styles.baseIcon}>
                  <SectionIcon kind="database" />
                </span>
                <span>
                  {base.name}
                  <small>已关联此引擎实例</small>
                </span>
                <span>查看知识库 ↗</span>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <SectionIcon kind="database" />
            <strong>暂无知识库使用此引擎</strong>
            <p>保存连接后，在知识库页面手动创建或连接知识库。</p>
          </div>
        )}
      </section>
    </div>
  );
}
