'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { businessRequest, BusinessApiError, businessIdempotencyKey } from '@qitu/api-client';
import {
  businessOrderLabel,
  formatBusinessMoney,
  type BusinessCatalog,
  type BusinessOrder,
  type ProjectOffer,
} from '@qitu/contracts';
import styles from './purchases.module.css';

function PaymentCode({ value }: { value: string }) {
  const code = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const size = qr.getModuleCount();
    const cells: string[] = [];
    for (let row = 0; row < size; row++)
      for (let column = 0; column < size; column++)
        if (qr.isDark(row, column)) cells.push(`M${column + 4},${row + 4}h1v1h-1z`);
    return { size: size + 8, path: cells.join('') };
  }, [value]);
  return (
    <svg
      className={styles.qr}
      role="img"
      aria-label="此订单的微信支付二维码"
      viewBox={`0 0 ${code.size} ${code.size}`}
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="white" />
      <path d={code.path} fill="#102d47" />
    </svg>
  );
}

export function ProjectPurchases({ studentId }: { studentId: string }) {
  const [catalog, setCatalog] = useState<BusinessCatalog | null>(null);
  const [orders, setOrders] = useState<BusinessOrder[]>([]);
  const [selected, setSelected] = useState<ProjectOffer | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(true);
  const [refundOrder, setRefundOrder] = useState('');
  const [reason, setReason] = useState('');
  const generation = useRef(0);
  const currentChild = useRef(studentId);
  currentChild.current = studentId;
  const keys = useRef(new Map<string, string>());
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const identity = ++generation.current;
      setLoading(true);
      try {
        const [c, rows] = await Promise.all([
          businessRequest<BusinessCatalog>('public/project-offers', { signal }),
          studentId
            ? businessRequest<BusinessOrder[]>(
                `parent/children/${encodeURIComponent(studentId)}/orders`,
                { signal },
              )
            : Promise.resolve([]),
        ]);
        if (identity !== generation.current || currentChild.current !== studentId) return false;
        setCatalog(c);
        setOrders(rows);
        setError('');
        return true;
      } catch (e) {
        if (identity !== generation.current || signal?.aborted) return false;
        if (e instanceof BusinessApiError && (e.status === 401 || e.status === 403)) {
          setOrders([]);
          setCatalog(null);
        }
        setError(e instanceof Error ? e.message : '课程订单读取失败');
        return false;
      } finally {
        if (identity === generation.current) setLoading(false);
      }
    },
    [studentId],
  );

  useEffect(() => {
    const abort = new AbortController();
    setCatalog(null);
    setOrders([]);
    setSelected(null);
    setRefundOrder('');
    setNotice('');
    setAgreed(false);
    setConsented(false);
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

  async function act(identity: string, fn: (key: string) => Promise<unknown>) {
    if (busy || !online) return;
    const child = studentId;
    const operation = `${child}:${identity}`;
    const key = keys.current.get(operation) ?? businessIdempotencyKey();
    keys.current.set(operation, key);
    setBusy(true);
    setError('');
    setNotice('');
    let committed = false;
    try {
      await fn(key);
      committed = true;
      if (currentChild.current !== child) return;
      if (!(await load())) throw new Error('操作已提交，订单回读失败');
      keys.current.delete(operation);
      if (identity.startsWith('create:')) setSelected(null);
      setNotice('订单状态已更新。');
    } catch (e) {
      if (currentChild.current === child)
        setError(
          committed
            ? '操作已提交，订单状态尚未核实。请刷新订单后再继续。'
            : e instanceof Error
              ? e.message
              : '操作未完成',
        );
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || loading || !online;
  return (
    <section className={styles.section} aria-labelledby="purchases-title">
      <div className={styles.heading}>
        <div>
          <small>项目学习服务</small>
          <h2 id="purchases-title">为下一次探究做好准备</h2>
          <p>查看课程安排、开通记录和服务约定。</p>
        </div>
        <button
          type="button"
          className={styles.secondary}
          disabled={disabled}
          onClick={() => void load()}
        >
          刷新订单
        </button>
      </div>
      {!online && (
        <p className={styles.error} role="alert">
          当前已断网，恢复连接后请刷新订单。
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
          <button
            className={styles.secondary}
            onClick={() => void load()}
            disabled={!online || loading}
          >
            重试
          </button>
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {loading && !catalog && (
        <p role="status" className={styles.empty}>
          正在读取课程与订单…
        </p>
      )}
      {!studentId && (
        <p className={styles.empty}>
          请先完成监护关系绑定，绑定后即可为孩子开通课程。可通过现有消息与反馈入口联系平台。
        </p>
      )}
      {catalog && (
        <>
          <div className={styles.steps}>
            <span>选择项目包</span>
            <span>家长确认并支付</span>
            <span>孩子确认项目</span>
            <span>回看学习成果</span>
          </div>
          <div className={styles.offers}>
            {catalog.offers.map((offer) => (
              <article key={offer.id} className={styles.offer}>
                <span className={styles.tag}>{offer.accessDays} 天学习服务</span>
                <h3>{offer.title}</h3>
                <p>{offer.summary}</p>
                <small>{offer.audience}</small>
                <ul>
                  {offer.outcomes.map((outcome) => (
                    <li key={outcome}>{outcome}</li>
                  ))}
                </ul>
                <div className={styles.offerFooter}>
                  <strong>{formatBusinessMoney(offer.priceFen)}</strong>
                  <button
                    className={styles.primary}
                    disabled={disabled || !studentId || !catalog.purchasing.available}
                    onClick={() => {
                      setSelected(offer);
                      setAgreed(false);
                      setConsented(false);
                    }}
                  >
                    {catalog.purchasing.available ? '查看并开通' : '暂未开放购买'}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!catalog.offers.length && (
            <p className={styles.empty}>项目包正在准备中。已有的学习项目可继续查看进展。</p>
          )}
          {selected && (
            <div className={styles.confirm}>
              <div className={styles.heading}>
                <div>
                  <h3>确认开通 {selected.title}</h3>
                  <p>
                    {formatBusinessMoney(selected.priceFen)}，支付后 {selected.accessDays} 天有效。
                  </p>
                </div>
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => setSelected(null)}
                >
                  收起
                </button>
              </div>
              {[
                ['服务条款', catalog.operator.termsText],
                ['隐私与未成年人数据说明', catalog.operator.privacyText],
                ['退款规则', catalog.operator.refundText],
              ].map(([label, text]) => (
                <details key={label}>
                  <summary>{label}</summary>
                  <p className={styles.terms}>{text}</p>
                </details>
              ))}
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                我已阅读并同意本项目包的服务、隐私与退款规则。
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(e) => setConsented(e.target.checked)}
                />
                我是当前孩子的已授权监护人，同意按上述说明处理提供学习服务所需的数据。
              </label>
              <p className={styles.muted}>
                开通后由孩子在 AI搭档中选择该项目并确认意图。学习仍需完成理论检查与作品评价。
              </p>
              <button
                className={styles.primary}
                disabled={disabled || !agreed || !consented || !catalog.purchasing.available}
                onClick={() =>
                  void act(
                    `create:${selected.id}:${selected.revision}:${catalog.operator.revision}`,
                    async (key) => {
                      const order = await businessRequest<BusinessOrder>('parent/orders', {
                        method: 'POST',
                        key,
                        body: {
                          offerId: selected.id,
                          offerRevision: selected.revision,
                          settingsRevision: catalog.operator.revision,
                          studentId,
                          acceptedTerms: true,
                          guardianConsent: true,
                        },
                      });
                      await businessRequest(`parent/orders/${order.id}/checkout`, {
                        method: 'POST',
                        key: `checkout-${key}`,
                      });
                    },
                  )
                }
              >
                {busy
                  ? '正在准备订单…'
                  : `创建订单并支付 ${formatBusinessMoney(selected.priceFen)}`}
              </button>
            </div>
          )}
          {orders.length > 0 && (
            <div className={styles.orderList}>
              <h3>当前孩子的课程订单</h3>
              {orders.map((order) => (
                <article key={order.id} className={styles.order}>
                  <div className={styles.heading}>
                    <div>
                      <h4>{order.offer.title}</h4>
                      <small>{order.id}</small>
                    </div>
                    <span className={styles.tag}>
                      {businessOrderLabel(order.status)} · {formatBusinessMoney(order.amountFen)}
                    </span>
                  </div>
                  {order.status === 'pending' && new Date(order.checkoutExpiresAt) > new Date() && (
                    <div className={styles.payment}>
                      {order.checkoutUrl ? (
                        <>
                          <PaymentCode value={order.checkoutUrl} />
                          <div>
                            <strong>请使用微信扫码</strong>
                            <p>
                              支付有效至 {new Date(order.checkoutExpiresAt).toLocaleString('zh-CN')}
                              。
                            </p>
                            <p>付款后点击查询，平台核验后会显示开通结果。</p>
                          </div>
                        </>
                      ) : (
                        <button
                          className={styles.primary}
                          disabled={disabled}
                          onClick={() =>
                            void act(`checkout:${order.id}`, (key) =>
                              businessRequest(`parent/orders/${order.id}/checkout`, {
                                method: 'POST',
                                key,
                              }),
                            )
                          }
                        >
                          获取支付二维码
                        </button>
                      )}
                    </div>
                  )}
                  {order.status === 'paid' && (
                    <p className={styles.notice}>
                      课程已开通，有效至{' '}
                      {order.accessUntil
                        ? new Date(order.accessUntil).toLocaleDateString('zh-CN')
                        : '待核实'}
                      。请由孩子进入 AI搭档选择此课程并确认项目。
                    </p>
                  )}
                  {order.status === 'pending' &&
                    new Date(order.checkoutExpiresAt) <= new Date() && (
                      <p className={styles.muted}>
                        支付时间已过，请先查询付款状态；核清并关闭原订单后才能重新下单。
                      </p>
                    )}
                  <details>
                    <summary>查看下单时的服务约定</summary>
                    <p className={styles.terms}>{order.terms.termsText}</p>
                    <p className={styles.terms}>{order.terms.refundText}</p>
                    <p className={styles.muted}>
                      {order.terms.operatorName} · {order.terms.supportEmail}
                    </p>
                  </details>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      disabled={disabled}
                      onClick={() =>
                        void act(`reconcile:${order.id}`, () =>
                          businessRequest(`parent/orders/${order.id}/reconcile`, {
                            method: 'POST',
                          }),
                        )
                      }
                    >
                      查询付款与退款状态
                    </button>
                    {order.status === 'paid' && (
                      <button
                        className={styles.secondary}
                        disabled={disabled}
                        onClick={() => {
                          setRefundOrder(order.id);
                          setReason('');
                        }}
                      >
                        申请退款
                      </button>
                    )}
                  </div>
                  {refundOrder === order.id && (
                    <form
                      className={styles.refund}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(`refund:${order.id}:${reason}`, (key) =>
                          businessRequest(`parent/orders/${order.id}/refund`, {
                            method: 'POST',
                            key,
                            body: { reason },
                          }),
                        );
                      }}
                    >
                      <label>
                        退款原因
                        <textarea
                          required
                          maxLength={300}
                          rows={2}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <button className={styles.secondary} disabled={disabled || !reason.trim()}>
                        提交退款申请
                      </button>
                    </form>
                  )}
                </article>
              ))}
            </div>
          )}
          {catalog.operator.supportEmail && (
            <p className={styles.muted}>
              服务提供方：{catalog.operator.operatorName} · 客服{' '}
              <a href={`mailto:${catalog.operator.supportEmail}`}>
                {catalog.operator.supportEmail}
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
