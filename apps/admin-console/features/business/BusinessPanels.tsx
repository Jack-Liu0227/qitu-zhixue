'use client';
import { businessRequest } from '@qitu/api-client';
import {
  businessOrderLabel,
  formatBusinessMoney,
  type BusinessDashboard,
  type ProjectOffer,
  type ReadinessResponse,
} from '@qitu/contracts';
import type { BusinessAction } from './BusinessWorkspace';
import styles from './business.module.css';
import { BusinessExpenseForm } from './BusinessExpenseForm';

const date = (s: string | null) =>
  s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '尚未运行';
type PanelProps = { data: BusinessDashboard; disabled: boolean; act: BusinessAction };

export function BusinessOverview({
  data,
  health,
  disabled,
  act,
}: PanelProps & { health: ReadinessResponse | null }) {
  const m = data.metrics;
  return (
    <>
      <div className={styles.metrics}>
        {[
          [
            '实收扣退款',
            formatBusinessMoney(m.revenueFen - m.refundedFen),
            '尚未扣除支付、模型和人工成本',
          ],
          ['已付款订单', String(m.paidOrders), `已退款 ${m.refundOrders} 单`],
          ['已完成项目', String(m.learningCompleted), `已开始 ${m.learningStarted} 个付费项目`],
          ['待处理事项', String(data.tasks.length), `已收到 ${m.consultations} 条咨询`],
        ].map(([label, value, hint]) => (
          <article className={styles.metric} key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
            <span>{hint}</span>
          </article>
        ))}
      </div>
      <div className={styles.columns}>
        <section className={styles.panel}>
          <h2>从订单到学习成果</h2>
          <p className={styles.note}>来自已核验支付与现有项目记录。不同事件采用各自计数口径。</p>
          <div className={styles.funnel}>
            {[
              ['创建订单', m.orders],
              ['完成付款', m.paidOrders],
              ['开始项目', m.learningStarted],
              ['完成项目', m.learningCompleted],
            ].map(([label, value]) => (
              <div className={styles.funnelRow} key={label}>
                <span>{label}</span>
                <div className={styles.track}>
                  <span
                    style={{
                      width: `${Math.min(100, (Number(value) / Math.max(1, m.orders, m.learningStarted)) * 100)}%`,
                    }}
                  />
                </div>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            再次购买的家长 {m.repeatBuyers} 位。学习完成来自服务端完成记录。
          </p>
        </section>
        <section className={styles.panel}>
          <h2>真实运行状态</h2>
          <p className={styles.note}>
            {health ? `检测时间 ${date(health.checkedAt)}` : '依赖探针尚未读取成功，请刷新重试。'}
          </p>
          <div className={styles.healthGrid}>
            {[
              ['数据库', health?.dependencies.database.status],
              ['Redis', health?.dependencies.redis.status],
              ['微信支付', data.payment.configured ? 'configured' : 'not_configured'],
            ].map(([label, status]) => (
              <div key={label}>
                <small>{label}</small>
                <span className={`${styles.status} ${status !== 'ok' ? styles.warning : ''}`}>
                  {status === 'ok'
                    ? '连接正常'
                    : status === 'configured'
                      ? '已配置，待联调'
                      : status === 'not_configured'
                        ? '未配置'
                        : status === 'error'
                          ? '连接失败'
                          : '尚未核验'}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.note}>上次运营检查 {date(data.automation.lastRunAt)}</p>
          <button
            className={styles.secondary}
            disabled={disabled}
            onClick={() =>
              void act('check', () => businessRequest('admin/business/check', { method: 'POST' }))
            }
          >
            运行运营检查
          </button>
        </section>
      </div>
      <section className={styles.panel} style={{ marginTop: 20 }}>
        <h2>模型调用与账单核对</h2>
        <p className={styles.note}>
          已记录 {m.modelCalls} 次调用，输入 {m.inputTokens.toLocaleString()} tokens，输出{' '}
          {m.outputTokens.toLocaleString()} tokens，{m.unknownUsageCalls}{' '}
          次缺少完整上游用量。统计从本功能启用后开始，用量不等于供应商实际账单。
        </p>
      </section>
      <BusinessExpenseForm data={data} disabled={disabled} act={act} />
    </>
  );
}

export function BusinessOffersPanel({
  data,
  disabled,
  edit,
}: Omit<PanelProps, 'act'> & { edit: (offer: ProjectOffer | 'new') => void }) {
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>可交付的项目包</h2>
          <p className={styles.note}>价格、成果和服务期限由你确定。</p>
        </div>
        <button className={styles.primary} disabled={disabled} onClick={() => edit('new')}>
          创建项目包
        </button>
      </div>
      <div className={styles.list}>
        {data.offers.map((o) => (
          <div key={o.id} className={styles.row}>
            <div>
              <strong>{o.title}</strong>
              <p>
                {o.audience} · {o.accessDays} 天 ·{' '}
                {o.status === 'published' ? '已发布' : o.status === 'archived' ? '已下架' : '草稿'}
              </p>
            </div>
            <div className={styles.actions}>
              <span className={styles.money}>{formatBusinessMoney(o.priceFen)}</span>
              <button className={styles.secondary} disabled={disabled} onClick={() => edit(o)}>
                编辑
              </button>
            </div>
          </div>
        ))}
      </div>
      {!data.offers.length && (
        <div className={styles.empty}>
          还没有项目包。先选定一个可以完整交付的课程，再填写价格和成果。
        </div>
      )}
    </section>
  );
}

export function BusinessOrdersPanel({ data, disabled, act }: PanelProps) {
  return (
    <section className={styles.panel}>
      <h2>最近订单</h2>
      <p className={styles.note}>显示最近 50 笔订单。付款和退款状态均以服务端核验为准。</p>
      {!data.recentOrders.length && (
        <div className={styles.empty}>
          尚无订单。发布项目包并完成商户配置后，可邀请家长体验购买流程。
        </div>
      )}
      <div className={styles.list}>
        {data.recentOrders.map((order) => (
          <div className={styles.row} key={order.id}>
            <div>
              <strong>{order.subscription?.product.title ?? order.offer?.title ?? '历史课程'}</strong>
              <p>
                {order.id} · {date(order.createdAt)}
              </p>
              <small>
                {order.refundReason
                  ? `退款原因：${order.refundReason}`
                  : order.accessUntil
                    ? `权益有效至 ${date(order.accessUntil)}`
                    : '等待支付回执'}
              </small>
            </div>
            <div className={styles.actions}>
              <span className={styles.money}>{formatBusinessMoney(order.amountFen)}</span>
              <span className={styles.tag}>{businessOrderLabel(order.status)}</span>
              {['refund_requested', 'refunding'].includes(order.status) && (
                <button
                  className={styles.secondary}
                  disabled={disabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        `将为订单 ${order.id} 发起全额原路退款 ${formatBusinessMoney(order.amountFen)}，确认继续？`,
                      )
                    )
                      void act(`refund:${order.id}`, (key) =>
                        businessRequest(`admin/business/orders/${order.id}/refund`, {
                          method: 'POST',
                          key,
                        }),
                      );
                  }}
                >
                  {order.status === 'refunding' ? '查询并重试退款' : '确认原路退款'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BusinessCustomersPanel({ data, disabled, act }: PanelProps) {
  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <h2>家庭自助注册</h2>
        <p>学生与家长可分别创建个人账号。监护关系完成核验后，家长可为已绑定孩子开通课程。</p>
        <a href="/login?mode=register" target="_blank" rel="noreferrer">查看家庭注册入口</a>
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>今天需要处理</h2>
            <p className={styles.note}>来自运营检查的持久化待办。</p>
          </div>
          <button
            className={styles.secondary}
            disabled={disabled}
            onClick={() =>
              void act('check', () => businessRequest('admin/business/check', { method: 'POST' }))
            }
          >
            检查待办
          </button>
        </div>
        {!data.tasks.length && (
          <div className={styles.empty}>
            暂无待办。最近检查时间为 {date(data.automation.lastRunAt)}。
          </div>
        )}
        {data.tasks.map((task) => (
          <div key={task.id} className={styles.row}>
            <div>
              <strong>{task.title}</strong>
              <small>
                {task.referenceId} · {date(task.createdAt)}
              </small>
            </div>
            <button
              className={styles.secondary}
              disabled={disabled}
              onClick={() =>
                void act(`task:${task.id}`, (key) =>
                  businessRequest(`admin/business/tasks/${task.id}/resolve`, {
                    method: 'POST',
                    key,
                  }),
                )
              }
            >
              标记已处理
            </button>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>咨询跟进</h2>
        <p className={styles.note}>
          仅管理员可见，显示最近 100 条咨询。联系资料只用于已提交的咨询服务。
        </p>
        {!data.leads.length && (
          <div className={styles.empty}>还没有咨询线索。官网联系页的提交会显示在这里。</div>
        )}
        {data.leads.map((lead) => (
          <div key={lead.id} className={styles.row}>
            <div>
              <strong>
                {lead.name} · <a href={`tel:${lead.phone}`}>{lead.phone}</a>
              </strong>
              <p>{lead.message || '未填写补充说明'}</p>
              <small>{date(lead.createdAt)}</small>
            </div>
            <div className={styles.actions}>
              <span className={styles.tag}>
                {lead.status === 'received'
                  ? '待跟进'
                  : lead.status === 'contacted'
                    ? '已联系'
                    : '已关闭'}
              </span>
              {lead.status === 'received' && (
                <button
                  className={styles.secondary}
                  disabled={disabled}
                  onClick={() =>
                    void act(`lead:${lead.id}:contacted`, (key) =>
                      businessRequest(`admin/business/leads/${lead.id}`, {
                        method: 'PATCH',
                        key,
                        body: { status: 'contacted' },
                      }),
                    )
                  }
                >
                  记录已联系
                </button>
              )}
              {lead.status !== 'closed' && (
                <button
                  className={styles.secondary}
                  disabled={disabled}
                  onClick={() =>
                    void act(`lead:${lead.id}:closed`, (key) =>
                      businessRequest(`admin/business/leads/${lead.id}`, {
                        method: 'PATCH',
                        key,
                        body: { status: 'closed' },
                      }),
                    )
                  }
                >
                  关闭线索
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
