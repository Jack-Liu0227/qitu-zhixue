import Link from 'next/link';
import { formatBusinessMoney, type CommerceCatalog } from '@qitu/contracts';
import styles from './offers.module.css';
import { MembershipRetry } from './MembershipRetry';
export async function SubscriptionShowcase({ home = false }: { home?: boolean }) {
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
    <section
      id="membership"
      className={`public-section ${styles.section} ${home ? styles.homeMembership : ''}`}
      aria-labelledby="membership-title"
    >
      <div className="home-shell">
        <div className={styles.heading}>
          <p className="public-kicker">会员方案</p>
          <h2 id="membership-title">从一次好奇，走向持续探究。</h2>
          <p>
            从免费账号开始，按孩子的探索需要选择体验课或成长会员。
            付费权益按学生开通，家长账号免费，不自动续费。
          </p>
        </div>
        <div className={`${styles.grid} ${styles.membershipGrid}`}>
          <article className={`${styles.card} ${styles.freeCard}`}>
            <div className={styles.meta}>
              <span>免费注册</span>
              <span>个人账号</span>
            </div>
            <h3>基础版</h3>
            <p>先了解学习方式，找到孩子愿意探索的真实问题。</p>
            <div className={styles.outcomes}>
              <ul>
                <li>浏览公开项目与学习方式</li>
                <li>查看已有作品与成长记录</li>
                <li>
                  {catalog?.policy.enabled
                    ? '每日 10 次基础问答，体验范围以已开放课程为准'
                    : '课程体验范围以平台当前开放内容为准'}
                </li>
              </ul>
            </div>
            <div className={styles.footer}>
              <strong>免费</strong>
              <Link className="home-btn home-btn--outline" href="/login?mode=register">
                免费注册
              </Link>
            </div>
          </article>
          {catalog ? (
            catalog.products
              .filter((p) => ['trial', 'month', 'year'].includes(p.id) && p.status !== 'archived')
              .map((p) => {
                const available =
                  p.id !== 'year' && p.status === 'published' && catalog.purchasing.available;
                return (
                  <article
                    className={`${styles.card} ${p.id === 'month' ? styles.monthCard : ''}`}
                    key={p.id}
                  >
                    <div className={styles.meta}>
                      <span>{p.id === 'year' ? '暂未开放' : available ? '已开放' : '待开放'}</span>
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
                        <li>按学生开通，不自动续费</li>
                      </ul>
                    </div>
                    <div className={styles.footer}>
                      <div>
                        <strong>{formatBusinessMoney(p.priceFen)}</strong>
                        <small>{p.months === 1 ? '/ 月' : p.months === 12 ? '/ 年' : '/ 次'}</small>
                      </div>
                      <Link
                        className={`home-btn ${available ? 'home-btn--primary' : 'home-btn--outline'}`}
                        href={
                          available
                            ? `/login?role=parent&next=${encodeURIComponent(`/parent?plan=${p.id}#subscriptions`)}`
                            : '/contact'
                        }
                      >
                        {available ? '家长登录购买' : '咨询开放安排'}
                      </Link>
                    </div>
                  </article>
                );
              })
          ) : (
            <div className={`${styles.empty} ${styles.membershipMessage}`} role="alert">
              <strong>会员方案暂时无法读取</strong>
              <p>请检查网络后重试，或联系平台了解开放安排。</p>
              <MembershipRetry />
            </div>
          )}
          {catalog &&
            !catalog.products.some(
              (p) => ['trial', 'month', 'year'].includes(p.id) && p.status !== 'archived',
            ) && (
              <p className={`${styles.empty} ${styles.membershipMessage}`}>
                当前没有可展示的付费方案，可以先免费注册或联系平台。
              </p>
            )}
        </div>
        {catalog && (
          <>
            <p className={styles.note}>
              9.9 元体验课每生限购一次，会员已包含。支付后 7 天内升级月会员可抵扣 9.9
              元。年卡为条件性方案，暂不售卖。
              {!catalog.purchasing.available && catalog.purchasing.reason}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export function SubscriptionShowcaseLoading() {
  return (
    <section id="membership" className={`public-section ${styles.section}`} aria-label="会员方案">
      <div className="home-shell" role="status">
        正在读取会员方案与开放状态…
      </div>
    </section>
  );
}
