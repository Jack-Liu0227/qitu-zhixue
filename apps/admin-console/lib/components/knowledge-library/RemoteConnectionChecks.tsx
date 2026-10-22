'use client';

import { useEffect, useRef, useState } from 'react';
import type { KnowledgeMatrixLibrary } from '@qitu/contracts';
import {
  checkLibraryConnection,
  fetchKnowledgeMatrix,
  type KnowledgeConnectionCheck,
} from '../../api/knowledge-center';
import { AdminApiError, AdminPermissionError, newIdempotencyKey } from '../../api/types';
import { connectionDiagnostic, remoteLibraries } from './connection-checks';
import { Glyph, message, time } from './shared';
import styles from './RemoteConnectionChecks.module.css';

type Outcome =
  | { kind: 'queued' | 'checking' }
  | { kind: 'checked'; receipt: KnowledgeConnectionCheck }
  | { kind: 'uncertain' | 'rejected'; message: string };
type Check = {
  library: KnowledgeMatrixLibrary;
  key: string;
  outcome: Outcome;
};

export function RemoteConnectionChecks({
  online,
  disabled,
  onBusyChange,
  onChanged,
  onConfigure,
}: {
  online: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged: () => Promise<void>;
  onConfigure: (id: string) => Promise<void>;
}) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const uncertain = checks.filter((check) => check.outcome.kind === 'uncertain');
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy || uncertain.length > 0) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, uncertain.length]);
  const completed = checks.filter((check) => check.outcome.kind === 'checked');
  const passed = completed.filter(
    (check) => check.outcome.kind === 'checked' && check.outcome.receipt.ok,
  ).length;
  const authFailed = completed.filter(
    (check) =>
      check.outcome.kind === 'checked' &&
      connectionDiagnostic(
        check.outcome.receipt.status,
        check.outcome.receipt.errorCode,
        check.outcome.receipt.checkedAt,
      ).kind === 'auth',
  ).length;

  async function run(replay = false) {
    if (running.current || disabled || !online || (!replay && uncertain.length)) return;
    running.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setNotice('');
    try {
      let queue = uncertain;
      if (!replay) {
        const snapshot = await fetchKnowledgeMatrix();
        if (!alive.current) return;
        if (!snapshot.complete)
          throw new Error('知识库目录不完整，无法确认全部远程库，请先修复目录读取。');
        queue = remoteLibraries(snapshot.libraries).map((library) => ({
          library,
          key: newIdempotencyKey(),
          outcome: { kind: 'queued' },
        }));
        setChecks(queue);
      }
      if (!queue.length) {
        setNotice('没有可检测的远程知识库，本地索引库不参与此检测。');
        return;
      }
      let cursor = 0;
      let denied = false;
      const update = (check: Check, outcome: Outcome) => {
        if (alive.current)
          setChecks((current) =>
            current.map((row) => (row.key === check.key ? { ...row, outcome } : row)),
          );
      };
      const worker = async () => {
        while (alive.current && cursor < queue.length) {
          const check = queue[cursor++];
          if (!check) return;
          if (denied || !navigator.onLine) {
            update(check, {
              kind: replay ? 'uncertain' : 'rejected',
              message: denied
                ? '管理账号权限已失效，未发起此项检测。'
                : '当前离线，未发起此项检测。',
            });
            continue;
          }
          update(check, { kind: 'checking' });
          try {
            const receipt = await checkLibraryConnection(
              check.library.id,
              { expectedRevision: check.library.revision },
              check.key,
            );
            update(check, { kind: 'checked', receipt });
          } catch (e) {
            if (e instanceof AdminPermissionError) denied = true;
            const rejected =
              (!replay && e instanceof AdminPermissionError) ||
              (e instanceof AdminApiError && e.status >= 400 && e.status < 500);
            update(check, { kind: rejected ? 'rejected' : 'uncertain', message: message(e) });
          }
        }
      };
      // Bound upstream requests; every uncertain check retains its original revision and key.
      await Promise.all([worker(), worker()]);
      if (!alive.current) return;
      try {
        await onChanged();
      } catch {
        setError('检测结果已返回，但知识库目录刷新失败。请重新读取目录；未确认项仍需核验。');
      }
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  return (
    <section className={styles.panel} aria-label="远程知识库连接检测" aria-busy={busy}>
      <div className={styles.heading}>
        <div>
          <h2>远程知识库连接检测</h2>
          <p>检测全部远程库，不受搜索或引擎筛选影响。不修改凭证、资源关联或助手绑定。</p>
        </div>
        <div className={styles.actions}>
          <button
            disabled={!online || disabled || busy || uncertain.length > 0}
            onClick={() => void run()}
          >
            <Glyph name="refresh" />
            {busy ? '正在检测…' : '一键检测远程知识库'}
          </button>
          {uncertain.length > 0 && (
            <button disabled={!online || disabled || busy} onClick={() => void run(true)}>
              核验未确认项
            </button>
          )}
        </div>
      </div>
      {!online && <p role="status">当前离线，恢复网络后再检测。</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {checks.length > 0 && (
        <>
          <p role="status" aria-live="polite">
            已返回 {completed.length}/{checks.length} 项，连接通过 {passed} 项，认证/授权异常{' '}
            {authFailed} 项，待核验 {uncertain.length} 项。
          </p>
          <p className={styles.hint}>
            认证/授权被拒绝不一定是过期，也可能是权限被撤销。未完成项不代表远端认证失效。检测会更新库修订号，未保存的绑定草稿仍保留。
          </p>
          <ul className={styles.results}>
            {checks.map((check) => {
              const { outcome, library } = check;
              const diagnostic =
                outcome.kind === 'checked'
                  ? connectionDiagnostic(
                      outcome.receipt.status,
                      outcome.receipt.errorCode,
                      outcome.receipt.checkedAt,
                    )
                  : null;
              return (
                <li key={check.key} data-kind={diagnostic?.kind ?? outcome.kind}>
                  <div className={styles.resultTitle}>
                    <strong>{library.name}</strong>
                    <span>
                      {diagnostic?.label ??
                        (outcome.kind === 'queued'
                          ? '等待检测'
                          : outcome.kind === 'checking'
                            ? '正在检测'
                            : outcome.kind === 'uncertain'
                              ? '结果待核验'
                              : '未完成检测')}
                    </span>
                  </div>
                  <p>
                    {diagnostic?.detail ?? ('message' in outcome ? outcome.message : '请稍候。')}
                  </p>
                  {outcome.kind === 'checked' && (
                    <small>
                      检测时间：{time(outcome.receipt.checkedAt)}
                      {outcome.receipt.errorCode ? ` · ${outcome.receipt.errorCode}` : ''}
                    </small>
                  )}
                  <button
                    disabled={busy || disabled || !online}
                    onClick={() => void onConfigure(library.id)}
                  >
                    配置此库
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
