'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { businessRequest, businessIdempotencyKey } from '@qitu/api-client';
import {
  formatBusinessMoney as money,
  type BusinessCatalog,
  type CommerceAccount,
  type CommerceCatalog,
  type CommerceProduct,
} from '@qitu/contracts';
import styles from './subscriptions.module.css';

export function SubscriptionPurchases({
  studentId,
  onOrderCreated,
  refreshToken,
}: {
  studentId: string;
  onOrderCreated: () => Promise<unknown>;
  refreshToken: string;
}) {
  const [catalog, setCatalog] = useState<CommerceCatalog | null>(null),
    [account, setAccount] = useState<CommerceAccount | null>(null),
    [terms, setTerms] = useState<BusinessCatalog['operator'] | null>(null);
  const [selected, setSelected] = useState<CommerceProduct | null>(null),
    [agreed, setAgreed] = useState(false),
    [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const version = useRef(0),
    currentStudent = useRef(studentId),
    locked = useRef(false),
    keys = useRef(new Map<string, string>());
  currentStudent.current = studentId;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const generation = ++version.current;
      setLoading(true);
      try {
        const [c, a, t] = await Promise.all([
          businessRequest<CommerceCatalog>('public/subscriptions', { signal }),
          studentId
            ? businessRequest<CommerceAccount>(
                `parent/children/${encodeURIComponent(studentId)}/subscription`,
                { signal },
              )
            : Promise.resolve(null),
          businessRequest<BusinessCatalog>('public/project-offers', { signal }),
        ]);
        if (
          generation !== version.current ||
          signal?.aborted ||
          currentStudent.current !== studentId
        )
          return false;
        setCatalog(c);
        setAccount(a);
        setTerms(t.operator);
        setError('');
        return true;
      } catch (e) {
        if (generation === version.current && !signal?.aborted) {
          setAccount(null);
          setError(e instanceof Error ? e.message : '权益信息读取失败');
        }
        return false;
      } finally {
        if (generation === version.current) setLoading(false);
      }
    },
    [studentId],
  );
  useEffect(() => {
    const abort = new AbortController();
    setAccount(null);
    setSelected(null);
    setAgreed(false);
    setConsent(false);
    setNotice('');
    void load(abort.signal);
    return () => {
      ++version.current;
      abort.abort();
    };
  }, [load, refreshToken]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  async function buy() {
    if (!selected || !catalog || !studentId || !agreed || !consent || locked.current || !online)
      return;
    const child = studentId,
      product = selected;
    const identity = `${child}:${product.id}:${product.revision}:${catalog.settingsRevision}`;
    const key = keys.current.get(identity) ?? businessIdempotencyKey();
    keys.current.set(identity, key);
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let committed = false;
    try {
      await businessRequest('parent/subscriptions/orders', {
        method: 'POST',
        key,
        body: {
          productId: product.id,
          productRevision: product.revision,
          settingsRevision: catalog.settingsRevision,
          studentId: child,
          acceptedTerms: true,
          guardianConsent: true,
        },
      });
      committed = true;
      if (currentStudent.current !== child) return;
      if ((await onOrderCreated()) === false) throw new Error('订单回读失败');
      if (currentStudent.current !== child) return;
      keys.current.delete(identity);
      setSelected(null);
      setNotice('订单已创建，请在下方订单列表打开微信付款码。付款核实后开通权益。');
    } catch (e) {
      if (currentStudent.current === child)
        setError(
          committed
            ? '订单已提交，请刷新下方订单核对状态，避免重复下单。'
            : e instanceof Error
              ? e.message
              : '订单创建失败',
        );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const disabled = busy || loading || !online,
    member = account?.entitlements.some((e) => ['month', 'year'].includes(e.source));
  const discount = selected?.id === 'month' ? (account?.trialDiscountFen ?? 0) : 0;
  return (
    <section id="subscriptions" className={styles.section} aria-labelledby="subscriptions-title">
      <div className={styles.heading}>
        <div>
          <small>让每一次好奇持续生长</small>
          <h2 id="subscriptions-title">选择适合孩子的探究方式</h2>
          <p>按学生开通，家长账号免费。权益、有效期与 AI 用量都清楚可见。</p>
        </div>
        <button className={styles.secondary} disabled={disabled} onClick={() => void load()}>
          刷新权益
        </button>
      </div>
      {!online && (
        <p role="alert" className={styles.error}>
          当前已断网，恢复连接后请刷新权益。
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
          <button className={styles.secondary} disabled={disabled} onClick={() => void load()}>
            重试
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {loading && !catalog && <p role="status">正在读取会员与体验课…</p>}
      {catalog && (
        <>
          <div className={styles.grid}>
            <article className={styles.card}>
              <small>从一个问题开始</small>
              <h3>基础版</h3>
              <div className={styles.price}>免费</div>
              <ul>
                <li>灵感浏览与 1 个入门体验</li>
                <li>每天 10 次基础 AI 问答</li>
                <li>已有作品与基础成长记录</li>
              </ul>
              <span className={styles.badge}>随个人账号使用</span>
            </article>
            {catalog.products
              .filter((p) => ['trial', 'month', 'year'].includes(p.id) && p.status !== 'archived')
              .map((p) => (
                <article
                  key={p.id}
                  className={`${styles.card} ${p.id === 'month' ? styles.featured : ''}`}
                >
                  <small>
                    {p.id === 'trial'
                      ? '20–30 分钟独立短探究'
                      : p.id === 'month'
                        ? '为持续探索留出空间'
                        : '条件性方案'}
                  </small>
                  <h3>{p.title}</h3>
                  <div className={styles.price}>
                    {money(p.priceFen)}
                    <small> / {p.id === 'trial' ? '次' : p.id === 'month' ? '月' : '年'}</small>
                  </div>
                  <p>{p.summary}</p>
                  <ul>
                    <li>
                      {p.id === 'trial'
                        ? 'AI 引导、探究卡与体验小结'
                        : '个性化 AI 搭档与作品集整理'}
                    </li>
                    <li>
                      {p.quota} 次有效 AI 交互 / {p.months ? '月' : '有效期'}
                    </li>
                    <li>
                      {p.id === 'trial'
                        ? '支付后 7 天内升级月会员抵扣 9.9 元'
                        : '成长报告与家长详细看板'}
                    </li>
                  </ul>
                  {p.id === 'month' && !!account?.trialDiscountFen && (
                    <p className={styles.discount}>
                      当前可抵扣 {money(account.trialDiscountFen)}，实付{' '}
                      {money(p.priceFen - account.trialDiscountFen)}
                    </p>
                  )}
                  <button
                    disabled={
                      disabled ||
                      !studentId ||
                      !catalog.purchasing.available ||
                      p.status !== 'published' ||
                      (p.id === 'trial' && (!!account?.trialPurchased || !!member))
                    }
                    onClick={() => {
                      setSelected(p);
                      setAgreed(false);
                      setConsent(false);
                    }}
                  >
                    {p.status !== 'published'
                      ? '待开放'
                      : p.id === 'trial' && member
                        ? '会员已包含'
                        : p.id === 'trial' && account?.trialPurchased
                          ? '已购买体验课'
                          : p.id === 'month' && member
                            ? '手动续费'
                            : '查看并购买'}
                  </button>
                </article>
              ))}
          </div>
          {!studentId && (
            <p className={styles.note}>请先选择已核验监护关系的孩子，再查看权益和购买。</p>
          )}
          {!catalog.purchasing.available && (
            <p className={styles.note}>
              {catalog.purchasing.reason}。以上为产品方案，未发布产品不能下单。
            </p>
          )}
          <p className={styles.note}>
            不自动续费，不自动转会员。“不限项目数量”限会员目录内，AI
            用量单独计算。系统判分、内部多助手调用及失败重试不重复扣次数。购买不改变理论掌握和作品评价要求。
          </p>
        </>
      )}
      {selected && terms && (
        <section className={styles.confirm} aria-label="确认订阅购买">
          <div className={styles.heading}>
            <h3>确认 {selected.title}</h3>
            <button className={styles.secondary} disabled={busy} onClick={() => setSelected(null)}>
              取消
            </button>
          </div>
          <p>
            为当前选中的孩子开通。原价 {money(selected.priceFen)}
            {discount > 0 && `，体验课抵扣 ${money(discount)}`}，实付{' '}
            <strong>{money(selected.priceFen - discount)}</strong>。
          </p>
          <p>
            {selected.id === 'trial'
              ? '付款后 7 天有效，每生限购一次。'
              : '按自然月计算；有效会员续费将在当前服务结束后衔接。'}
            不自动扣款。
          </p>
          {[
            ['服务条款', terms.termsText],
            ['隐私说明', terms.privacyText],
            ['退款规则', terms.refundText],
          ].map(([title, content]) => (
            <details key={title}>
              <summary>{title}</summary>
              <p>{content || '尚未配置'}</p>
            </details>
          ))}
          <label>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            我已阅读服务、隐私及退款规则
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            我有权为当前孩子购买并授权提供上述服务
          </label>
          <button disabled={disabled || !agreed || !consent} onClick={() => void buy()}>
            创建订单 · {money(selected.priceFen - discount)}
          </button>
        </section>
      )}
      {account && (
        <section className={styles.entitlements}>
          <h3>当前孩子的权益与用量</h3>
          {!account.enabled && (
            <p className={styles.note}>新订阅策略尚未启用，已有项目包按原规则提供服务。</p>
          )}
          {account.entitlements.map((e) => (
            <article key={e.id}>
              <div>
                <strong>{e.title}</strong>
                <small>
                  {e.organizationId
                    ? '机构课内权益'
                    : e.source === 'free'
                      ? '基础问答'
                      : '个人权益'}{' '}
                  ·{' '}
                  {e.source === 'free'
                    ? '每天重置'
                    : `${new Date(e.startsAt).toLocaleDateString('zh-CN')} — ${new Date(e.endsAt).toLocaleDateString('zh-CN')}`}
                </small>
              </div>
              <div>
                <b>
                  {e.used} / {e.quota}
                </b>
                <small>
                  有效交互{e.reserved ? `，处理中 ${e.reserved}` : ''} ·{' '}
                  {new Date(e.resetsAt).toLocaleDateString('zh-CN')} 重置
                </small>
                <progress
                  value={e.used + e.reserved}
                  max={e.quota}
                  aria-label={`${e.title}已使用交互次数`}
                />
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
