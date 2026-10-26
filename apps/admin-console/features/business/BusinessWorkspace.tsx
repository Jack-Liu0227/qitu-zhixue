'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { businessRequest, BusinessApiError, businessIdempotencyKey } from '@qitu/api-client';
import type {
  BusinessDashboard,
  BusinessSettings,
  ProjectOffer,
  ReadinessResponse,
  SaveProjectOffer,
} from '@qitu/contracts';
import { BusinessSettingsForm, OfferEditor } from './BusinessForms';
import {
  BusinessOverview,
  BusinessOrdersPanel,
  BusinessCustomersPanel,
  BusinessOffersPanel,
} from './BusinessPanels';
import styles from './business.module.css';

type Tab = 'overview' | 'offers' | 'orders' | 'customers';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '经营总览' },
  { id: 'offers', label: '项目包与服务' },
  { id: 'orders', label: '订单与交付' },
  { id: 'customers', label: '客户与待办' },
];
export type BusinessAction = (
  identity: string,
  fn: (key: string) => Promise<unknown>,
) => Promise<void>;
export const businessDate = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未运行';

export default function BusinessWorkspace() {
  const [data, setData] = useState<BusinessDashboard | null>(null);
  const [health, setHealth] = useState<ReadinessResponse | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [editing, setEditing] = useState<ProjectOffer | 'new' | null>(null);
  const sequence = useRef(0);
  const keys = useRef(new Map<string, string>());
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    try {
      const [dashboard, ready] = await Promise.allSettled([
        businessRequest<BusinessDashboard>('admin/business', { signal: controller.signal }),
        fetch('/api/v1/health/ready', {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        }).then(async (r): Promise<ReadinessResponse> => {
          if (r.status !== 200 && r.status !== 503) throw new Error('探针读取失败');
          return r.json();
        }),
      ]);
      if (id !== sequence.current) return false;
      setHealth(ready.status === 'fulfilled' ? ready.value : null);
      if (dashboard.status === 'rejected') throw dashboard.reason;
      setData(dashboard.value);
      setError('');
      return true;
    } catch (e) {
      if (id !== sequence.current) return false;
      if (e instanceof BusinessApiError && (e.status === 401 || e.status === 403)) setData(null);
      setError(e instanceof Error ? e.message : '经营数据读取失败');
      return false;
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const change = () => setOnline(navigator.onLine);
    change();
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      ++sequence.current;
      abort.current?.abort();
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, [refresh]);

  const act: BusinessAction = async (identity, fn) => {
    if (busy || !online) return;
    const key = keys.current.get(identity) ?? businessIdempotencyKey();
    keys.current.set(identity, key);
    setBusy(true);
    setNotice('');
    setError('');
    let written = false;
    try {
      await fn(key);
      written = true;
      if (!(await refresh())) throw new Error('操作已提交，最新状态读取失败');
      keys.current.delete(identity);
      setNotice('已完成操作，并读取最新状态。');
    } catch (e) {
      setError(
        written
          ? '操作已提交，但结果尚未核实。请刷新查看最新状态，重试会沿用原操作标识。'
          : e instanceof Error
            ? e.message
            : '操作未完成',
      );
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || !online || loading;
  const phases = [
    {
      title: '准备商品',
      status: data?.offers.some((o) => o.status === 'published')
        ? '项目包已发布'
        : '待填写资料与项目包',
      ready: Boolean(data?.offers.some((o) => o.status === 'published')),
    },
    {
      title: '交易与交付',
      status: data?.metrics.paidOrders
        ? '已收到支付回执'
        : data?.payment.configured
          ? '待真实交易验收'
          : '待配置支付商户',
      ready: Boolean(data?.metrics.paidOrders),
    },
    {
      title: '小批量试运营',
      status: data?.metrics.learningCompleted ? '已有完成项目记录' : '待真实用户完成项目',
      ready: Boolean(data?.metrics.learningCompleted),
    },
    {
      title: '运营自动化',
      status:
        data?.automation.enabled && data.automation.lastRunAt
          ? '检查已启用，有运行记录'
          : '待启用运营检查',
      ready: Boolean(data?.automation.enabled && data.automation.lastRunAt),
    },
  ];

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>QITU · OPERATIONS</p>
          <h1>把学习交付，经营好。</h1>
          <p>跟进客户、核对订单，关注每一个项目的真实进展。</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.tag}>
            {loading
              ? '正在读取…'
              : data
                ? `更新于 ${businessDate(data.generatedAt)}`
                : '尚未连接经营数据'}
          </span>
          <button
            className={styles.secondary}
            disabled={busy || loading || !online}
            onClick={() => void refresh()}
          >
            刷新状态
          </button>
        </div>
      </header>
      {!online && (
        <div className={styles.error} role="alert">
          网络已断开。当前内容可能过期，恢复连接后请刷新。
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
          {data && ' 下方保留上次读取内容，请核对更新时间。'}
          <button
            className={styles.secondary}
            onClick={() => void refresh()}
            disabled={loading || !online}
          >
            重新读取
          </button>
        </div>
      )}
      {notice && (
        <div className={styles.success} role="status">
          {notice}
        </div>
      )}
      <div className={styles.phases}>
        {phases.map((p, i) => (
          <div key={p.title} className={styles.phase} data-active={p.ready}>
            <small>阶段 {i + 1}</small>
            <strong>{p.title}</strong>
            <span>{p.status}</span>
          </div>
        ))}
      </div>
      {!data && loading ? (
        <div className={styles.skeleton} role="status" aria-label="正在加载经营数据" />
      ) : null}
      {data ? (
        <>
          <div className={styles.tabs} role="tablist" aria-label="经营工作区">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`business-tab-${t.id}`}
                aria-controls={`business-panel-${t.id}`}
                aria-selected={tab === t.id}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const index = TABS.findIndex((x) => x.id === tab);
                    const next =
                      TABS[(index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
                    if (next) {
                      setTab(next.id);
                      document.getElementById(`business-tab-${next.id}`)?.focus();
                    }
                  }
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`business-panel-${tab}`} aria-labelledby={`business-tab-${tab}`}>
            {tab === 'overview' && (
              <BusinessOverview data={data} health={health} disabled={disabled} act={act} />
            )}
            {tab === 'offers' && (
              <div className={styles.stack}>
                <BusinessSettingsForm
                  key={data.settings.revision}
                  initial={data.settings}
                  busy={disabled}
                  save={(s: BusinessSettings) =>
                    act(`settings:${JSON.stringify(s)}`, (key) =>
                      businessRequest('admin/business/settings', { method: 'PATCH', body: s, key }),
                    )
                  }
                />
                <BusinessOffersPanel data={data} disabled={disabled} edit={setEditing} />
                {editing && (
                  <OfferEditor
                    key={editing === 'new' ? 'new' : `${editing.id}:${editing.revision}`}
                    offer={editing === 'new' ? null : editing}
                    templates={data.templates}
                    busy={disabled}
                    close={() => setEditing(null)}
                    save={(offer: SaveProjectOffer) =>
                      act(`offer:${JSON.stringify(offer)}`, async (key) => {
                        const saved = await businessRequest<ProjectOffer>('admin/business/offers', {
                          method: 'POST',
                          body: offer,
                          key,
                        });
                        setEditing(saved);
                      })
                    }
                  />
                )}
              </div>
            )}
            {tab === 'orders' && <BusinessOrdersPanel data={data} disabled={disabled} act={act} />}
            {tab === 'customers' && (
              <BusinessCustomersPanel data={data} disabled={disabled} act={act} />
            )}
          </div>
        </>
      ) : !loading && !error ? (
        <div className={styles.empty}>暂无可读取的经营数据。</div>
      ) : null}
    </div>
  );
}
