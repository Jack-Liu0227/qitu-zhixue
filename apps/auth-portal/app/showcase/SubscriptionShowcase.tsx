import Link from 'next/link';
import { formatBusinessMoney, type CommerceCatalog } from '@qitu/contracts';
import styles from './offers.module.css';
export async function SubscriptionShowcase() {
  let catalog: CommerceCatalog | null = null;
  try {
    const r = await fetch(
      `${process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100'}/api/v1/public/subscriptions`,
      { cache: 'no-store', signal: AbortSignal.timeout(3000) },
    );
    if (r.ok) catalog = (await r.json()).data;
  } catch {
    /* Render the explicit unavailable state below. */
  }
  return (
    <section className={`public-section ${styles.section}`} aria-labelledby="membership-title">
      <div className="home-shell">
        <div className={styles.heading}>
          <p className="public-kicker">体验与成长会员</p>
          <h2 id="membership-title">从一次好奇，走向持续探究。</h2>
          <p>
            免费基础版包含灵感浏览、1 个入门体验、每天 10
            次基础问答。按学生开通付费权益，家长账号免费。
          </p>
        </div>
        {catalog ? (
          <>
            <div className={styles.grid}>
              {catalog.products
                .filter((p) => ['trial', 'month', 'year'].includes(p.id) && p.status !== 'archived')
                .map((p) => (
                  <article className={styles.card} key={p.id}>
                    <div className={styles.meta}>
                      <span>
                        {p.status === 'published' && catalog.purchasing.available
                          ? '已开放'
                          : '方案待开放'}
                      </span>
                      <span>{p.months ? `${p.months} 个月` : `${p.days} 天`}</span>
                    </div>
                    <h3>{p.title}</h3>
                    <p>{p.summary}</p>
                    <div className={styles.outcomes}>
                      <ul>
                        <li>
                          {p.quota} 次有效 AI 交互 / {p.months ? '月' : '有效期'}
                        </li>
                        <li>
                          {p.projectLimit === null
                            ? '会员目录内不限项目数量'
                            : '独立短课与体验小结'}
                        </li>
                        <li>不自动续费，学习门禁保持有效</li>
                      </ul>
                    </div>
                    <div className={styles.footer}>
                      <strong>{formatBusinessMoney(p.priceFen)}</strong>
                      <Link
                        className="home-btn home-btn--primary"
                        href={
                          p.status === 'published' && catalog.purchasing.available
                            ? '/login?role=parent&next=%2Fparent'
                            : '/contact'
                        }
                      >
                        {p.status === 'published' && catalog.purchasing.available
                          ? '家长登录购买'
                          : '咨询开放安排'}
                      </Link>
                    </div>
                  </article>
                ))}
            </div>
            <p className={styles.note}>
              9.9 元体验课每生限购一次，会员已包含。支付后 7 天内升级月会员可抵扣 9.9
              元。年卡为条件性方案，暂不售卖。
              {!catalog.purchasing.available && catalog.purchasing.reason}
            </p>
          </>
        ) : (
          <div className={styles.empty}>会员方案暂时无法读取，请稍后刷新或联系平台。</div>
        )}
      </div>
    </section>
  );
}
