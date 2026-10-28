import Link from 'next/link';
import { formatBusinessMoney, type BusinessCatalog } from '@qitu/contracts';
import styles from './offers.module.css';

export async function ProjectOfferShowcase() {
  let catalog: BusinessCatalog | null = null;
  try {
    const response = await fetch(
      `${process.env.QITU_API_ORIGIN ?? 'http://127.0.0.1:4100'}/api/v1/public/project-offers`,
      { cache: 'no-store', signal: AbortSignal.timeout(3000) },
    );
    if (response.ok) {
      const envelope: { data: BusinessCatalog } = await response.json();
      catalog = envelope.data;
    }
  } catch {
    /* The published template gallery remains available independently. */
  }
  return (
    <section
      className={`public-section ${styles.section}`}
      aria-labelledby="project-packages-title"
    >
      <div className="home-shell">
        <div className={styles.heading}>
          <p className="public-kicker">项目学习服务</p>
          <h2 id="project-packages-title">
            选一个值得投入的问题，
            <br />
            留下看得见的成长。
          </h2>
          <p>了解适合人群、交付成果和服务期限，再决定下一次探究。</p>
        </div>
        {catalog ? (
          <>
            <div className={styles.grid}>
              {catalog.offers.map((offer) => (
                <article className={styles.card} key={offer.id}>
                  <div className={styles.meta}>
                    <span>AI 搭档 · 自主探究</span>
                    <span>{offer.accessDays} 天</span>
                  </div>
                  <h3>{offer.title}</h3>
                  <p>{offer.summary}</p>
                  <small>{offer.audience}</small>
                  <div className={styles.outcomes}>
                    <strong>项目将留下</strong>
                    <ul>
                      {offer.outcomes.map((outcome) => (
                        <li key={outcome}>{outcome}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.footer}>
                    <div>
                      <strong>{formatBusinessMoney(offer.priceFen)}</strong>
                      <small>每个孩子 · 一次开通</small>
                    </div>
                    <Link
                      className="home-btn home-btn--primary"
                      href={catalog.purchasing.available ? '/login?role=parent&next=%2Fparent' : '/contact'}
                    >
                      {catalog.purchasing.available ? '家长登录后开通' : '咨询项目安排'}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
            {!catalog.offers.length && (
              <div className={styles.empty}>
                项目包正在准备中，可先浏览下方的公开课程与探究方向。
              </div>
            )}
            <div className={styles.process}>
              <span>了解项目与服务约定</span>
              <span>家长确认并支付</span>
              <span>学生确认学习意图</span>
              <span>探究、作品与成长记录</span>
            </div>
            <p className={styles.note}>
              课程开通后，学生仍须完成理论检查与作品评价。
              {catalog.operator.operatorName && `服务提供方：${catalog.operator.operatorName}。`}
            </p>
            {catalog.operator.termsText && (
              <div className={styles.policies}>
                {[
                  ['服务条款', catalog.operator.termsText],
                  ['隐私与未成年人数据说明', catalog.operator.privacyText],
                  ['退款规则', catalog.operator.refundText],
                ].map(([title, content]) => (
                  <details key={title}>
                    <summary>{title}</summary>
                    <p>{content}</p>
                  </details>
                ))}
                <p>
                  {catalog.operator.registrationInfo}{' '}
                  {catalog.operator.supportEmail && (
                    <a href={`mailto:${catalog.operator.supportEmail}`}>
                      {catalog.operator.supportEmail}
                    </a>
                  )}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className={styles.empty}>
            项目包信息暂时无法读取，请稍后刷新。您也可以到联系页咨询安排。
          </div>
        )}
      </div>
    </section>
  );
}
