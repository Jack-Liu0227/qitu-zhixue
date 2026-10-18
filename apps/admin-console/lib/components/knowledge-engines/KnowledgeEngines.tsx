'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  centerRequest,
  fetchCenterConfig,
  saveCenterConfig,
  type Engine,
  type EngineGroup,
  type EngineCheck,
  type EngineField,
} from '../../api/knowledge-center';
import { createIdempotentRetryKey } from '../../api/types';
import styles from './KnowledgeEngines.module.css';
import { RemoteEngineSettings } from './RemoteEngineSettings';

const labels: Record<string, string> = {
  ready: '可用',
  needs_key: '待配置凭证',
  needs_setup: '待完成配置',
  not_installed: '未安装',
  unavailable: '不可用',
  unreachable: '无法连接',
  unchecked: '未检查',
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
const aliases: Record<string, string> = {
  llmModelRef: 'baseModelRef',
  vector_top_k_multiplier: 'vector_candidate_multiplier',
  bm25_top_k_multiplier: 'bm25_candidate_multiplier',
  image_description_timeout_seconds: 'image_description_timeout',
  max_concurrent_files: 'file_concurrency',
  llm_model_max_async: 'llm_concurrency',
};
function Badge({ status }: { status: string }) {
  return (
    <span
      className={`${styles.badge} ${status === 'ready' ? styles.good : status === 'not_installed' || status === 'unchecked' ? styles.neutral : styles.warn}`}
    >
      <i />
      {labels[status] ?? status}
    </span>
  );
}
function Icon({ engine, size = 36 }: { engine: EngineGroup; size?: number }) {
  return (
    <span className={styles.icon} style={{ width: size + 16, height: size + 16 }}>
      {engine.definition?.icon ? (
        <img
          src={`/admin/knowledge-engine-icons/${engine.definition.icon}`}
          alt=""
          width={size}
          height={size}
        />
      ) : (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <ellipse cx="16" cy="7" rx="11" ry="4" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M5 7v9c0 5.5 22 5.5 22 0V7M5 16v9c0 5.5 22 5.5 22 0v-9"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      )}
    </span>
  );
}
type ModelOption = {
  value: string;
  label: string;
  available: boolean;
  input: string[];
  output: string[];
};
export function KnowledgeEngines({
  engines,
  online,
  onChanged,
  onOpenBase,
}: {
  engines: EngineGroup[];
  online: boolean;
  onChanged: () => Promise<void>;
  onOpenBase: (id: string) => void | Promise<void>;
}) {
  const [provider, setProvider] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState('');
  const [draft, setDraft] = useState<Engine | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [check, setCheck] = useState<EngineCheck | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [query, setQuery] = useState('');
  const retry = useRef(createIdempotentRetryKey());
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!provider) return;
    for (let node = detailRef.current; node; node = node.parentElement)
      node.scrollTo({ top: 0, behavior: 'instant' });
  }, [provider, instanceId]);
  const group = engines.find((e) => e.provider === provider);
  const instance = group?.instances.find((i) => i.id === instanceId);
  useEffect(() => {
    void centerRequest<ModelOption[]>('knowledge/engine-models')
      .then(setModels)
      .catch(() => setModels([]));
  }, []);
  const change = (next: Engine) => {
    setDraft(next);
    setDirty(true);
    setCheck(null);
    setNotice('');
  };
  const open = (e: EngineGroup, id?: string) => {
    const target = e.instances.find((i) => i.id === id) ?? e.instances[0];
    setProvider(e.provider);
    setInstanceId(target?.id ?? `${e.provider}-main`);
    setDraft(
      target
        ? {
            name: target.name,
            description: target.description,
            provider: target.provider,
            enabled: target.enabled,
            config: {
              ...Object.fromEntries(
                (e.definition?.fields ?? [])
                  .filter((f) => f.default !== undefined)
                  .map((f) => [f.key, f.default]),
              ),
              ...structuredClone(target.config),
            },
          }
        : {
            name: e.name,
            description: e.definition?.description ?? '',
            provider: e.provider,
            enabled: false,
            config: Object.fromEntries(
              (e.definition?.fields ?? [])
                .filter((f) => f.default !== undefined)
                .map((f) => [f.key, f.default]),
            ),
          },
    );
    setDirty(false);
    setCheck(null);
    setError('');
    setNotice('');
  };
  const back = () => {
    if (dirty && !window.confirm('有未保存的配置，确定放弃修改？')) return;
    setProvider(null);
    setDraft(null);
    setDirty(false);
  };
  const save = async () => {
    if (!draft) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Use the same revision and audited write API as the JSON workbench.
      const current = await fetchCenterConfig();
      const original = instance
        ? {
            name: instance.name,
            description: instance.description,
            provider: instance.provider,
            enabled: instance.enabled,
            config: instance.config,
          }
        : undefined;
      if (canonical(current.config.knowledgeEngines[instanceId]) !== canonical(original))
        throw new Error('配置已在其他页面变更，请返回列表重新读取后编辑。');
      const config = structuredClone(current.config);
      config.knowledgeEngines[instanceId] = draft;
      await saveCenterConfig(
        { expectedRevision: current.revision, config },
        retry.current.keyFor(`engine-save:${instanceId}:${JSON.stringify(draft)}`),
      );
      retry.current.acknowledge();
      setDirty(false);
      setCheck(null);
      setNotice('配置已保存；请重新检查连接后使用。');
      await onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const inspect = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await centerRequest<EngineCheck>(
        `knowledge/engines/${encodeURIComponent(instanceId)}/check`,
        'POST',
        {},
        retry.current.keyFor(`engine-check:${instanceId}`),
      );
      retry.current.acknowledge();
      setCheck(result);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '检查失败');
    } finally {
      setBusy(false);
    }
  };
  const fieldValue = (field: EngineField) =>
    draft?.config[field.key] ??
    (aliases[field.key] ? draft?.config[aliases[field.key]!] : undefined) ??
    field.default;
  const updateField = (field: EngineField, value: unknown) => {
    if (!draft) return;
    const config = { ...draft.config };
    if (aliases[field.key]) delete config[aliases[field.key]!];
    if (value === '' && field.type === 'model') delete config[field.key];
    else config[field.key] = value;
    change({ ...draft, config });
  };
  const field = (f: EngineField) => {
    const value = fieldValue(f);
    const id = `engine-${f.key}`;
    return (
      <div className={styles.field} key={f.key}>
        <label htmlFor={id}>{f.label}</label>
        {f.type === 'boolean' ? (
          <label className={styles.toggle}>
            <input
              id={id}
              type="checkbox"
              checked={value === true}
              onChange={(e) => updateField(f, e.target.checked)}
              disabled={busy || !online}
            />
            <span>{value === true ? '开启' : '关闭'}</span>
          </label>
        ) : f.type === 'select' ? (
          <select
            id={id}
            value={String(value ?? '')}
            onChange={(e) => updateField(f, e.target.value)}
            disabled={busy || !online}
          >
            {f.options?.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : f.type === 'model' ? (
          <select
            id={id}
            value={String(value ?? '')}
            onChange={(e) => updateField(f, e.target.value)}
            disabled={busy || !online}
          >
            <option value="">未绑定{f.key === 'embeddingModelRef' ? '' : ' / 继承基础模型'}</option>
            {models
              .filter((m) =>
                f.key === 'embeddingModelRef'
                  ? m.output.includes('embedding')
                  : f.key === 'vlmModelRef'
                    ? m.input.includes('image')
                    : m.output.includes('text'),
              )
              .map((m) => (
                <option key={m.value} value={m.value} disabled={!m.available}>
                  {m.label}
                  {m.available ? '' : ' · 不可用'}
                </option>
              ))}
            {Boolean(value) &&
              !models.some(
                (m) =>
                  m.value === value &&
                  (f.key === 'embeddingModelRef'
                    ? m.output.includes('embedding')
                    : f.key === 'vlmModelRef'
                      ? m.input.includes('image')
                      : m.output.includes('text')),
              ) && (
                <option value={String(value)}>{String(value)} · 现有绑定（请检查模型能力）</option>
              )}
          </select>
        ) : f.type === 'list' ? (
          <textarea
            id={id}
            rows={4}
            value={Array.isArray(value) ? value.join('\n') : ''}
            onChange={(e) =>
              updateField(
                f,
                e.target.value
                  .split('\n')
                  .map((v) => v.trim())
                  .filter(Boolean),
              )
            }
            disabled={busy || !online}
          />
        ) : (
          <input
            id={id}
            type={f.type === 'number' ? 'number' : 'text'}
            value={String(value ?? '')}
            min={f.min}
            max={f.max}
            step={f.type === 'number' ? 1 : undefined}
            onChange={(e) =>
              updateField(
                f,
                f.type === 'number'
                  ? e.target.value === ''
                    ? ''
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
            disabled={busy || !online}
          />
        )}
        {f.description && <small>{f.description}</small>}
        {f.min !== undefined && (
          <small>
            范围 {f.min}–{f.max}
          </small>
        )}
      </div>
    );
  };
  if (group && draft) {
    const status = instance?.health?.health_status ?? instance?.health?.status ?? 'unchecked';
    if (['lightrag-server', 'pageindex', 'ima', 'weknora'].includes(group.provider))
      return (
        <section
          className={`${styles.root} ${styles.hostedDetail}`}
          aria-label="知识引擎详情"
          ref={detailRef}
        >
          <button className={styles.back} onClick={back}>
            ← 全部知识引擎
          </button>
          <div className={styles.detailHeader}>
            <Icon engine={group} size={42} />
            <div>
              <div className={styles.hostedTitle}>
                <h2>{group.name}</h2>
                <Badge status={dirty ? 'needs_setup' : status} />
              </div>
              <p>{group.group} · 远程连接</p>
            </div>
          </div>
          {group.instances.length > 1 && (
            <label className={styles.instancePicker}>
              切换引擎实例
              <select
                aria-label="切换引擎实例"
                value={instanceId}
                onChange={(e) => {
                  if (!dirty || window.confirm('放弃未保存修改？')) open(group, e.target.value);
                }}
              >
                {group.instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {i.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <div role="alert" className={styles.error}>
              {error}
            </div>
          )}
          <RemoteEngineSettings
            key={`${group.provider}:${instanceId}`}
            group={group}
            draft={draft}
            instanceId={instanceId}
            dirty={dirty}
            busy={busy}
            online={online}
            check={check}
            onChange={change}
            onSave={save}
            onInspect={inspect}
            onChanged={onChanged}
            onOpenBase={onOpenBase}
            renderField={field}
          />
        </section>
      );
    return (
      <section className={styles.root} aria-label="知识引擎详情" ref={detailRef}>
        <button className={styles.back} onClick={back}>
          ← 全部知识引擎
        </button>
        <div className={styles.detailHeader}>
          <Icon engine={group} size={42} />
          <div>
            <div className={styles.eyebrow}>{group.group}</div>
            <h2>{group.name}</h2>
            <p>{group.definition?.description}</p>
          </div>
          <Badge status={dirty ? 'needs_setup' : status} />
        </div>
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
        <div className={styles.detailLayout}>
          <div className={styles.main}>
            <section className={styles.panel}>
              <div className={styles.sectionTitle}>
                <h3>实例与运行状态</h3>
                <span>{instance ? '已登记' : '新实例'}</span>
              </div>
              {group.instances.length > 1 && (
                <label>
                  切换实例
                  <select
                    aria-label="切换引擎实例"
                    value={instanceId}
                    onChange={(e) => {
                      if (!dirty || window.confirm('放弃未保存修改？')) open(group, e.target.value);
                    }}
                  >
                    {group.instances.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} · {i.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="engine-instance-id">实例 ID</label>
                  <input
                    id="engine-instance-id"
                    value={instanceId}
                    disabled={!!instance || busy}
                    pattern="[a-z][a-z0-9-]*"
                    onChange={(e) => {
                      setInstanceId(e.target.value);
                      setDirty(true);
                    }}
                  />
                  <small>与 JSON 配置树中的实例 ID 一致</small>
                </div>
                <div className={styles.field}>
                  <label htmlFor="engine-name">显示名称</label>
                  <input
                    id="engine-name"
                    value={draft.name}
                    onChange={(e) => change({ ...draft, name: e.target.value })}
                    disabled={busy || !online}
                  />
                </div>
              </div>
              <label className={styles.enabled}>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => change({ ...draft, enabled: e.target.checked })}
                  disabled={busy || !online}
                />
                启用此引擎<span>启用与连接可用性分别检查</span>
              </label>
              <div className={styles.actionRow}>
                <button
                  className={styles.primary}
                  onClick={() => void save()}
                  disabled={busy || !online || (!dirty && !!instance)}
                >
                  {busy ? '处理中…' : instance ? '保存配置' : '添加引擎实例'}
                </button>
                <button
                  onClick={() => void inspect()}
                  disabled={busy || !online || dirty || !instance}
                >
                  检查环境与连接
                </button>
                <Link href={`/settings/tools?knowledgeEngine=${encodeURIComponent(instanceId)}`}>
                  JSON 配置 ↗
                </Link>
              </div>
              <p className={styles.caption}>
                {dirty
                  ? '有未保存的修改；检查使用保存后的配置。'
                  : instance?.health?.checked_at
                    ? `上次检查：${new Date(instance.health.checked_at).toLocaleString('zh-CN')}`
                    : '尚无当前配置的检查结果。'}{' '}
                {instance?.health?.error_code ?? ''}
              </p>
              {instance?.health?.capabilities && (
                <div className={styles.tags} aria-label="实测引擎能力">
                  {[
                    ['canIndex', '构建索引'],
                    ['canSearch', '检索资料'],
                    ['canMaterialize', '项目收集'],
                  ].map(([key, label]) => (
                    <span key={key}>
                      {label}：
                      {dirty
                        ? '待重新检查'
                        : instance.health?.capabilities?.[
                              key as 'canIndex' | 'canSearch' | 'canMaterialize'
                            ]
                          ? '可用'
                          : '不可用'}
                    </span>
                  ))}
                </div>
              )}
            </section>
            {Array.from(new Set(group.definition?.fields.map((f) => f.group) ?? [])).map(
              (section) => (
                <section className={styles.panel} key={section}>
                  <div className={styles.sectionTitle}>
                    <h3>{section}</h3>
                    {section === '模型绑定' && (
                      <Link href="/settings/model-providers">管理模型 ↗</Link>
                    )}
                  </div>
                  <div className={styles.formGrid}>
                    {group.definition?.fields.filter((f) => f.group === section).map(field)}
                  </div>
                </section>
              ),
            )}
            <section className={styles.panel}>
              <div className={styles.sectionTitle}>
                <h3>环境与连接预检</h3>
                {check && <Badge status={check.status ?? (check.ok ? 'ready' : 'unavailable')} />}
              </div>
              {check ? (
                <>
                  <p className={styles.caption}>
                    {check.errorCode ?? (check.ok ? '所需检查已通过' : '请完成以下配置后重新检查')}
                  </p>
                  {check.checks?.map((c) => (
                    <div className={styles.checkRow} key={c.key}>
                      <span className={c.ok ? styles.checkGood : styles.checkBad}>
                        {c.ok ? '✓' : '!'}
                      </span>
                      <div>
                        <strong>
                          {c.label}
                          {c.optional ? ' · 可选' : ''}
                        </strong>
                        <p>{c.detail}</p>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className={styles.empty}>保存配置后，检查依赖、模型、凭证及服务连接。</div>
              )}
            </section>
          </div>
          <aside className={styles.aside}>
            <section className={styles.panel}>
              <h3>使用前准备</h3>
              <p>{group.definition?.prerequisites}</p>
              {group.definition?.installHint && (
                <code className={styles.command}>{group.definition.installHint}</code>
              )}
              <p className={styles.caption}>
                凭证通过服务器安全配置提供；此处与 JSON 编辑器均不回显密钥。
              </p>
            </section>
            <section className={styles.panel}>
              <h3>支持的管理操作</h3>
              <ul>
                {group.definition?.management.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              {!!group.definition?.modes.length && (
                <div className={styles.tags}>
                  {group.definition.modes.map((m) => (
                    <span key={m}>{m}</span>
                  ))}
                </div>
              )}
            </section>
            <section className={styles.panel}>
              <div className={styles.sectionTitle}>
                <h3>关联知识库</h3>
                <span>{instance?.associatedBases.length ?? 0}</span>
              </div>
              {instance?.associatedBases.length ? (
                instance.associatedBases.map((b) => (
                  <button
                    className={styles.baseLink}
                    key={b.id}
                    onClick={() => void onOpenBase(b.id)}
                  >
                    {b.name}
                    <span>↗</span>
                  </button>
                ))
              ) : (
                <div className={styles.empty}>暂无关联知识库</div>
              )}
            </section>
            <p className={styles.source}>
              引擎实现参照 DeepTutor v1.6.14
              <br />
              <a
                href="https://github.com/HKUDS/DeepTutor/tree/6cf793bd868ba5ecbe64722936d4be8fab5a01df"
                target="_blank"
                rel="noreferrer"
              >
                源码 6cf793b ↗
              </a>
            </p>
          </aside>
        </div>
      </section>
    );
  }
  const visible = engines.filter((e) =>
    (e.name + ' ' + e.provider + ' ' + e.definition?.description)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className={styles.root} aria-label="知识引擎目录">
      <div className={styles.intro}>
        <div>
          <div className={styles.eyebrow}>KNOWLEDGE ENGINES</div>
          <h2>为每一类资料，选择合适的检索方式</h2>
          <p>管理本地索引、独立服务与云端知识源，查看配置和真实运行状态。</p>
        </div>
        <div className={styles.count}>
          <strong>{engines.length}</strong>
          <span>种引擎与知识源</span>
        </div>
      </div>
      <div className={styles.toolbar}>
        <label>
          <span>⌕</span>
          <input
            aria-label="搜索知识引擎"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索引擎名称或用途"
          />
        </label>
        <span>{engines.reduce((n, e) => n + e.instances.length, 0)} 个已配置实例</span>
      </div>
      {['本地引擎', '服务器引擎', '云服务', '外部知识源'].map((category) => {
        const items = visible.filter((e) => e.group === category);
        return (
          items.length > 0 && (
            <section className={styles.category} key={category}>
              <div className={styles.categoryTitle}>
                <h3>{category}</h3>
                <span>{items.length}</span>
                <div />
              </div>
              <div className={styles.grid}>
                {items.map((e) => {
                  const health = e.instances[0]?.health;
                  const status =
                    health?.health_status ??
                    health?.status ??
                    (e.instances.length ? 'unchecked' : 'needs_setup');
                  return (
                    <button
                      className={styles.card}
                      key={e.provider}
                      onClick={() => open(e)}
                      aria-label={`管理 ${e.name}`}
                    >
                      <div className={styles.cardTop}>
                        <Icon engine={e} />
                        <Badge status={status} />
                      </div>
                      <h3>{e.name}</h3>
                      <p>{e.definition?.description}</p>
                      <div className={styles.tags}>
                        {(e.definition?.modes.length
                          ? e.definition.modes
                          : e.definition?.modelKinds.length
                            ? e.definition.modelKinds
                            : ['连接知识源']
                        )
                          .slice(0, 5)
                          .map((m) => (
                            <span key={m}>{m}</span>
                          ))}
                      </div>
                      <div className={styles.cardFooter}>
                        <span>
                          {e.instances.length
                            ? `${e.instances.length} 个实例 · ${e.instances.reduce((n, i) => n + i.associatedBases.length, 0)} 个关联库`
                            : '尚未配置实例'}
                        </span>
                        <strong>
                          管理引擎 <span>↗</span>
                        </strong>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )
        );
      })}
      {!visible.length && <div className={styles.empty}>没有匹配的知识引擎。</div>}
    </section>
  );
}
