'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  centerRequest,
  type BaseDetail,
  type EngineGroup,
  type KnowledgeConnectionCheck,
} from '../../api/knowledge-center';
import { newIdempotencyKey } from '../../api/types';
import { KnowledgeFileUpload } from '../KnowledgeFileUpload';
import { ImaLibraryPicker } from './ImaLibraryPicker';
import { Glyph, message, time } from './shared';
import styles from './KnowledgeConfiguration.module.css';

export function LibraryConfiguration({
  detail,
  engines,
  online,
  onClose,
  onChanged,
}: {
  detail: BaseDetail;
  engines: EngineGroup[];
  online: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [base, setBase] = useState(detail);
  const [name, setName] = useState(detail.name);
  const [engineChoice, setEngineChoice] = useState(detail.engine_instance_id ?? '');
  const [selection, setSelection] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [sourceKind, setSourceKind] = useState('web');
  const [sourceValue, setSourceValue] = useState('');
  const [schedule, setSchedule] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const pending = useRef<{
    path: string;
    method: 'POST' | 'PATCH';
    body: object;
    key: string;
  } | null>(null);
  const group = engines.find((g) => g.instances.some((i) => i.id === base.engine_instance_id));
  const engine = group?.instances.find((i) => i.id === base.engine_instance_id);
  const remote = !!base.connection && base.connection.status !== 'not_applicable';
  const disabled = busy || !online || uncertain;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  async function execute(path?: string, body?: object, method: 'POST' | 'PATCH' = 'POST') {
    if (!online || busy) return;
    if (!pending.current && path && body)
      pending.current = { path, method, body, key: newIdempotencyKey() };
    const request = pending.current;
    if (!request) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await centerRequest<Partial<KnowledgeConnectionCheck> & { deleted?: boolean }>(
        request.path,
        request.method,
        request.body,
        request.key,
      );
      setUncertain(true);
      if (result.deleted) {
        await onChanged();
        pending.current = null;
        setUncertain(false);
        onClose();
        return;
      }
      const next = await centerRequest<BaseDetail>(
        `knowledge/bases/${encodeURIComponent(base.id)}`,
      );
      setBase(next);
      await onChanged();
      pending.current = null;
      setUncertain(false);
      if (result.ok === false) setError(result.message ?? '连接检查失败');
      else setNotice(result.message ?? '配置已保存并回读确认');
      if (request.method === 'PATCH') {
        setSelecting(false);
        setSelection('');
      }
    } catch (e) {
      setError(message(e));
      // A business rejection has no uncertain write; an interrupted request must be replayed.
      if (
        e instanceof Error &&
        'status' in e &&
        typeof e.status === 'number' &&
        e.status >= 400 &&
        e.status < 500
      ) {
        pending.current = null;
        setUncertain(false);
      } else {
        setUncertain(true);
      }
    } finally {
      setBusy(false);
    }
  }
  const settings = (body: object) =>
    execute(`knowledge/bases/${encodeURIComponent(base.id)}/settings`, {
      expectedRevision: base.revision,
      ...body,
    });

  return createPortal(
    <div className={styles.overlay}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`配置知识库 ${base.name}`}
        tabIndex={-1}
        className={styles.drawer}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy && !uncertain) onClose();
          if (event.key !== 'Tab') return;
          const controls = panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary',
          );
          const first = controls?.[0],
            last = controls?.[controls.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === panel.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className={styles.header}>
          <div>
            <small>知识库配置</small>
            <h2>{base.name}</h2>
          </div>
          <button aria-label="关闭知识库配置" disabled={busy || uncertain} onClick={onClose}>
            <Glyph name="close" />
          </button>
        </header>
        <p>
          {group?.name ?? '未配置引擎'} · {remote ? '远端只读连接' : '本地索引库'}
        </p>
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
        {!online && <p className={styles.error}>当前离线，请恢复连接后继续。</p>}
        {uncertain && (
          <div className={styles.error}>
            提交状态待确认，需先核验本次操作。
            <button disabled={busy || !online} onClick={() => void execute()}>
              重试核验
            </button>
          </div>
        )}
        <section className={styles.section}>
          <label>
            知识库名称
            <input
              aria-label="知识库名称"
              value={name}
              maxLength={160}
              disabled={disabled}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button
              disabled={disabled || !name.trim() || name === base.name}
              onClick={() => void settings({ name })}
            >
              保存名称
            </button>
            <button
              disabled={disabled}
              onClick={() => void settings({ enabled: base.library_settings?.enabled === false })}
            >
              {base.library_settings?.enabled === false ? '启用知识库' : '停用知识库'}
            </button>
            <button
              disabled={disabled || base.library_settings?.isDefault}
              onClick={() => void settings({ isDefault: true })}
            >
              {base.library_settings?.isDefault ? '当前默认库' : '设为默认库'}
            </button>
          </div>
        </section>
        {remote && (
          <section className={styles.section}>
            <h3>连接与资源</h3>
            <p>
              状态：{base.connection?.status} · 最近检查：{time(base.connection?.lastCheckAt)}
            </p>
            {base.connection?.lastErrorCode && (
              <p className={styles.error}>{base.connection.lastErrorCode}</p>
            )}
            <p className={styles.muted}>
              原文件由原服务维护。连接检查、知识检索与原文读取分别验证。
            </p>
            <div className={styles.actions}>
              <button
                disabled={disabled}
                onClick={() =>
                  void execute(`knowledge/bases/${encodeURIComponent(base.id)}/check`, {
                    expectedRevision: base.revision,
                  })
                }
              >
                检查连接
              </button>
              {engine?.provider === 'ima' && (
                <button
                  disabled={disabled}
                  onClick={() => {
                    setSelecting(!selecting);
                    setSelection('');
                  }}
                >
                  重新关联
                </button>
              )}
              {engine?.provider === 'ima' && (
                <a href="https://ima.qq.com" target="_blank" rel="noreferrer">
                  前往 ima 管理文件
                </a>
              )}
            </div>
            {selecting && engine && (
              <div>
                <ImaLibraryPicker
                  key={engine.id}
                  instanceId={engine.id}
                  engine={engine}
                  saved
                  online={online}
                  disabled={disabled}
                  selectedId={selection}
                  onSelect={(id) => setSelection(id)}
                  onLoading={setPickerBusy}
                />
                <p className={styles.muted}>
                  确认资源后更新此连接，原助手绑定保留。旧项目继续按原冻结教材范围执行。
                </p>
                <button
                  disabled={disabled || pickerBusy || !selection}
                  onClick={() =>
                    void execute(
                      `knowledge/bases/${encodeURIComponent(base.id)}/connection`,
                      { expectedRevision: base.revision, remoteKnowledgeBaseId: selection },
                      'PATCH',
                    )
                  }
                >
                  验证并保存关联
                </button>
              </div>
            )}
          </section>
        )}
        <section className={styles.section}>
          <h3>助手授权</h3>
          <p>在页面下方的助手绑定矩阵统一编辑。</p>
          <button
            disabled={busy || uncertain}
            onClick={() => {
              onClose();
              requestAnimationFrame(() =>
                document
                  .getElementById('knowledge-binding-matrix')
                  ?.scrollIntoView({ behavior: 'smooth' }),
              );
            }}
          >
            定位绑定矩阵
          </button>
        </section>
        {!remote && base.kind !== 'project' && (
          <section className={styles.section}>
            <button
              aria-expanded={advanced}
              disabled={disabled}
              onClick={() => setAdvanced(!advanced)}
            >
              高级维护：素材导入与索引
            </button>
            {advanced && (
              <div className={styles.advanced}>
                <label>
                  索引引擎
                  <select
                    aria-label="索引引擎"
                    disabled={disabled}
                    value={engineChoice}
                    onChange={(e) => setEngineChoice(e.target.value)}
                  >
                    {engines
                      .filter((g) =>
                        [
                          'llamaindex',
                          'graphrag',
                          'lightrag',
                          'pageindex',
                          'pageindex-oss',
                        ].includes(g.provider),
                      )
                      .flatMap((g) =>
                        g.instances
                          .filter((i) => i.enabled)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {g.name} · {i.name}
                            </option>
                          )),
                      )}
                  </select>
                </label>
                <button
                  disabled={disabled || !engineChoice || engineChoice === base.engine_instance_id}
                  onClick={() => void settings({ engineInstanceId: engineChoice })}
                >
                  保存引擎，等待重建索引
                </button>
                <KnowledgeFileUpload
                  baseId={base.id}
                  onSaved={async () => {
                    setBase(
                      await centerRequest<BaseDetail>(
                        `knowledge/bases/${encodeURIComponent(base.id)}`,
                      ),
                    );
                    await onChanged();
                  }}
                />
                <button
                  disabled={
                    disabled ||
                    base.jobs.some(
                      (j) => !['ready', 'failed', 'empty', 'cancelled'].includes(j.state),
                    )
                  }
                  onClick={() =>
                    void execute(`knowledge/bases/${encodeURIComponent(base.id)}/rebuild`, {})
                  }
                >
                  重建索引
                </button>
                <label>
                  来源类型
                  <select
                    value={sourceKind}
                    disabled={disabled}
                    onChange={(e) => setSourceKind(e.target.value)}
                  >
                    <option value="web">网页</option>
                    <option value="github">GitHub</option>
                    <option value="folder">服务器允许目录</option>
                  </select>
                </label>
                <label>
                  来源地址
                  <input
                    value={sourceValue}
                    disabled={disabled}
                    onChange={(e) => setSourceValue(e.target.value)}
                    placeholder={
                      sourceKind === 'github'
                        ? 'owner/repository'
                        : sourceKind === 'folder'
                          ? '/服务器允许目录'
                          : 'https://example.com/article'
                    }
                  />
                </label>
                <label>
                  同步频率
                  <select
                    disabled={disabled}
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                  >
                    <option value="">仅手动</option>
                    <option value="24">每天</option>
                    <option value="168">每周</option>
                  </select>
                </label>
                <button
                  disabled={disabled || !sourceValue.trim()}
                  onClick={() =>
                    void execute(`knowledge/bases/${encodeURIComponent(base.id)}/sources`, {
                      kind: sourceKind,
                      scheduleHours: schedule ? Number(schedule) : null,
                      sourceConfig:
                        sourceKind === 'web'
                          ? { url: sourceValue, crawlMode: 'single_page' }
                          : sourceKind === 'github'
                            ? { repo: sourceValue, branch: 'HEAD', path: '', glob: '**/*' }
                            : { path: sourceValue },
                    })
                  }
                >
                  添加来源
                </button>
                {base.sources?.map((source) => (
                  <div key={source.id}>
                    <p>
                      {source.kind} · {source.status}
                      {source.lastErrorCode ? ` · ${source.lastErrorCode}` : ''}
                    </p>
                    <div className={styles.actions}>
                      <button
                        disabled={disabled || source.status === 'revoked'}
                        onClick={() =>
                          void execute(
                            `knowledge/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/sync`,
                            {},
                          )
                        }
                      >
                        同步来源
                      </button>
                      <button
                        disabled={disabled || source.status === 'revoked'}
                        onClick={() => {
                          if (window.confirm('取消此来源？相关资料将停止检索。'))
                            void execute(
                              `knowledge/bases/${encodeURIComponent(base.id)}/sources/${encodeURIComponent(source.id)}/settings`,
                              { revoked: true },
                            );
                        }}
                      >
                        取消来源
                      </button>
                    </div>
                  </div>
                ))}
                {base.jobs.slice(0, 5).map((job) => (
                  <p key={job.id}>
                    索引任务：{job.state}
                    {job.error_code ? ` · ${job.error_code}` : ''}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}
        <section className={styles.section}>
          <h3>移除配置</h3>
          <p>删除此知识库配置会停止助手访问，远端原文件保留。</p>
          <button
            className={styles.danger}
            disabled={disabled}
            onClick={() => {
              if (window.confirm(`删除知识库配置“${base.name}”？`))
                void settings({ deleted: true });
            }}
          >
            删除知识库配置
          </button>
        </section>
      </div>
    </div>,
    document.body,
  );
}
