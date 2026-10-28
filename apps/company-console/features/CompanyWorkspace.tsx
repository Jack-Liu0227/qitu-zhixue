'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CompanyOverview } from '@qitu/contracts';
import { CompanyApiError, companyApi, date, operationKey } from './api';
import { OverviewPanel, WorkPanel, TeamsPanel, DataPanel } from './OperatingPanels';
import {
  ProductsPanel,
  FinancePanel,
  CustomersPanel,
  KnowledgePanel,
  IntegrationsPanel,
} from './BusinessPanels';

const NAV = [
  ['overview', '经营总览', '◫'],
  ['work', '工作与成果', '↗'],
  ['teams', 'Agent 团队', '◎'],
  ['customers', '客户与机构', '♧'],
  ['products', '产品与订阅', '▤'],
  ['finance', '订单与财务', '¥'],
  ['data', '数据全景', '▥'],
  ['knowledge', '公司知识', '▧'],
  ['integrations', '飞书与集成', '⇄'],
];
export type CompanyAction = (path: string, body: unknown, method?: string) => Promise<void>;
export interface PanelProps {
  data: CompanyOverview;
  act: CompanyAction;
  busy: boolean;
  detail: unknown;
}

export function CompanyWorkspace({ section }: { section: string }) {
  const [data, setData] = useState<CompanyOverview | null>(null),
    [detail, setDetail] = useState<unknown>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true);
  const [error, setError] = useState(''),
    [status, setStatus] = useState(0),
    [notice, setNotice] = useState('');
  const generation = useRef(0),
    keys = useRef(new Map<string, string>()),
    locked = useRef(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const id = ++generation.current;
      setLoading(true);
      try {
        const overview = await companyApi<CompanyOverview>('company', { signal });
        const path = (
          {
            finance: 'finance',
            customers: 'organizations',
            knowledge: 'knowledge',
            integrations: 'integrations',
          } as Record<string, string>
        )[section];
        const extra = path ? await companyApi<unknown>(`company/${path}`, { signal }) : null;
        if (id !== generation.current || signal?.aborted) return false;
        setData(overview);
        setDetail(extra);
        setError('');
        setStatus(0);
        return true;
      } catch (e) {
        if (id !== generation.current || signal?.aborted) return false;
        if (e instanceof CompanyApiError) {
          setStatus(e.status);
          if ([401, 403].includes(e.status)) {
            setData(null);
            setDetail(null);
          }
        }
        setError(e instanceof Error ? e.message : '公司数据读取失败');
        return false;
      } finally {
        if (id === generation.current) setLoading(false);
      }
    },
    [section],
  );
  useEffect(() => {
    const abort = new AbortController();
    setDetail(null);
    void load(abort.signal);
    return () => {
      ++generation.current;
      abort.abort();
    };
  }, [load]);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    change();
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);
  useEffect(() => {
    if (
      section !== 'work' ||
      !data?.work.some((w) => w.status === 'running' || w.status === 'queued')
    )
      return;
    const timer = setInterval(() => {
      if (!locked.current && navigator.onLine) void load();
    }, 6000);
    return () => clearInterval(timer);
  }, [section, data?.work, load]);
  const act: CompanyAction = async (path, body, method = 'POST') => {
    if (locked.current || !online) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const identity = JSON.stringify([path, body, method]),
      key = keys.current.get(identity) ?? operationKey();
    keys.current.set(identity, key);
    let committed = false;
    try {
      await companyApi(path, {
        method,
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      });
      committed = true;
      if (!(await load())) throw new Error('已提交，回读尚未成功，请刷新核实');
      keys.current.delete(identity);
      setNotice('已保存，并已核对服务器状态。');
    } catch (e) {
      setError(
        committed
          ? '操作已提交，状态回读失败，请刷新核实。'
          : e instanceof Error
            ? e.message
            : '操作未完成',
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const label = NAV.find((n) => n[0] === section)?.[1] ?? '公司工作区';
  const props: PanelProps | null = data
    ? { data, detail, act, busy: busy || loading || !online }
    : null;
  return (
    <div className="company-shell">
      <a className="skip" href="#company-main">
        跳到工作区
      </a>
      <aside className="rail">
        <Link className="wordmark" href="/">
          <span className="brand-symbol">启</span>
          <span>
            启途智学<small>COMPANY WORKSPACE</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="signal" /> 一人公司 · 协同经营
        </div>
        <nav aria-label="公司工作区">
          {NAV.map(([id, title, symbol]) => (
            <Link
              key={id}
              href={id === 'overview' ? '/' : `/${id}`}
              aria-current={section === id ? 'page' : undefined}
              className={section === id ? 'active' : ''}
            >
              <span aria-hidden="true">{symbol}</span>
              {title}
            </Link>
          ))}
        </nav>
        <div className="rail-bottom">
          <p>
            学习，产生真实成长。
            <br />
            经营，留下可核对的成果。
          </p>
          <a href="/admin">平台管理 ↗</a>
          <a href="/">返回启途首页 ↗</a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            COMPANY <b>/</b> {label}
          </span>
          <span>
            {data?.actor.name ?? '公司工作区'}{' '}
            <i className="avatar">{data?.actor.name.slice(0, 1) ?? '启'}</i>
          </span>
        </header>
        <main id="company-main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">BUILD A COMPANY THAT LEARNS</div>
              <h1>{label}</h1>
              <p>
                {section === 'overview'
                  ? '把经营事实、团队行动和学习交付放在一起。'
                  : '每个任务有责任，每项数据有来源。'}
              </p>
            </div>
            <button
              className="secondary"
              disabled={loading || busy || !online}
              onClick={() => void load()}
            >
              ↻ 刷新数据
            </button>
          </div>
          {!online && (
            <div className="alert" role="alert">
              当前已断网。恢复连接后刷新，确认服务器状态。
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              {error}{' '}
              {status === 401 ? (
                <a href="/login?role=admin&next=%2Fcompany">登录公司账号</a>
              ) : status === 403 ? (
                <span>请由公司所有者配置成员权限。</span>
              ) : (
                <button
                  className="text-button"
                  onClick={() => void load()}
                  disabled={!online || loading}
                >
                  重试
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {loading && !data && (
            <div className="loading" role="status">
              <span className="loading-line" />
              正在连接公司工作区…
            </div>
          )}
          {props && (
            <>
              {section === 'overview' && <OverviewPanel {...props} />}
              {section === 'work' && <WorkPanel {...props} />}
              {section === 'teams' && <TeamsPanel {...props} />}
              {section === 'products' && <ProductsPanel {...props} />}
              {section === 'finance' && <FinancePanel {...props} />}
              {section === 'customers' && <CustomersPanel {...props} />}
              {section === 'data' && <DataPanel {...props} />}
              {section === 'knowledge' && <KnowledgePanel {...props} />}
              {section === 'integrations' && <IntegrationsPanel {...props} />}
              <footer className="page-footer">
                数据更新于 {date(props.data.generatedAt)} ·{' '}
                {props.data.dataMode === 'test'
                  ? '隔离测试数据'
                  : props.data.dataMode === 'demo'
                    ? '演示数据'
                    : '服务器真实数据'}{' '}
                <span>启途智学 / Company</span>
              </footer>
            </>
          )}
          {!loading && !data && !error && <div className="empty">暂无可读取的公司数据。</div>}
        </main>
      </div>
    </div>
  );
}
