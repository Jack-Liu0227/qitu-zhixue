'use client';

import { useEffect, useRef, useState } from 'react';
import {
  centerRequest,
  fetchCenterConfig,
  type BaseDetail,
  type Engine,
  type KnowledgeConnectionCheck,
} from '../../api/knowledge-center';
import { newIdempotencyKey } from '../../api/types';
import { message } from './shared';

type Receipt = Partial<KnowledgeConnectionCheck> & { deleted?: boolean };
type Pending = {
  path: string;
  body?: object;
  prepare?: () => Promise<object>;
  verify?: () => Promise<void>;
  started?: boolean;
  method: 'POST' | 'PATCH' | 'PUT';
  key: string;
  receipt?: Receipt;
};
export class LibraryReadbackConflict extends Error {}

export function useLibraryEditor(
  detail: BaseDetail,
  online: boolean,
  onChanged: () => Promise<void>,
  onDeleted: () => void,
) {
  const [base, setBase] = useState(detail);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filesRevision, setFilesRevision] = useState(0);
  const pending = useRef<Pending | null>(null);
  const running = useRef(false);
  const basePath = `knowledge/bases/${encodeURIComponent(base.id)}`;

  useEffect(() => {
    if (!busy && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, uncertain]);

  async function refresh() {
    const next = await centerRequest<BaseDetail>(basePath);
    setBase(next);
    setFilesRevision((value) => value + 1);
    await onChanged();
    return next;
  }
  async function readEngine(id: string, accept: (engine: Engine) => void) {
    if (!online || running.current || pending.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const current = await fetchCenterConfig();
      const engine = current.config.knowledgeEngines[id];
      if (!engine) throw new Error('知识引擎已不存在，请返回列表重新读取。');
      await refresh();
      accept(engine);
    } catch (error) {
      setError(message(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function execute(
    path?: string,
    body?: object | (() => Promise<object>),
    method: 'POST' | 'PATCH' | 'PUT' = 'POST',
    verify?: () => Promise<void>,
  ) {
    if (!online || running.current) return false;
    if (!pending.current && path && body)
      pending.current = {
        path,
        ...(typeof body === 'function' ? { prepare: body as () => Promise<object> } : { body }),
        method,
        verify,
        key: newIdempotencyKey(),
      };
    const request = pending.current;
    if (!request) return false;
    running.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!request.body) request.body = await request.prepare!();
      request.started = true;
      // Once acknowledged, retry only the readback; ambiguous writes replay the same key.
      request.receipt ??= await centerRequest<Receipt>(
        request.path,
        request.method,
        request.body,
        request.key,
      );
      setUncertain(true);
      if (request.path === `${basePath}/settings` && request.receipt.deleted) {
        await onChanged();
        pending.current = null;
        setUncertain(false);
        onDeleted();
        return true;
      }
      await refresh();
      await request.verify?.();
      const result = request.receipt;
      pending.current = null;
      setUncertain(false);
      if (result.ok === false) {
        setError(result.message ?? '连接检查失败');
        return false;
      }
      setNotice(result.message ?? '已保存并回读确认');
      return true;
    } catch (e) {
      setError(message(e));
      if (
        !request.started ||
        e instanceof LibraryReadbackConflict ||
        (!request.receipt &&
          e instanceof Error &&
          'status' in e &&
          typeof e.status === 'number' &&
          e.status >= 400 &&
          e.status < 500)
      ) {
        pending.current = null;
        setUncertain(false);
      } else setUncertain(true);
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const settings = (body: object) =>
    execute(`${basePath}/settings`, { expectedRevision: base.revision, ...body });
  return {
    base,
    basePath,
    busy,
    uncertain,
    error,
    notice,
    filesRevision,
    refresh,
    readEngine,
    execute,
    settings,
  };
}

export type LibraryEditor = ReturnType<typeof useLibraryEditor>;
