'use client';
import { useState } from 'react';
import {
  COMPANY_DEPARTMENTS,
  businessOrderLabel,
  type BusinessDashboard,
  type BusinessOrder,
  type CommerceProduct,
} from '@qitu/contracts';
import type { PanelProps } from './CompanyWorkspace';
import { date, money } from './api';
import { PaymentCode } from './PaymentCode';
import { CustomerLeads, ExpenseEntry } from './CommerceOperations';

export function ProductsPanel(props: PanelProps) {
  const { data, act, busy } = props;
  const [free, setFree] = useState(data.catalog.policy.freeTemplateVersionIds);
  return (
    <>
      <div className="callout">
        <strong>免费体验 → 9.9 元短课 → 成长会员</strong>
        <p>
          按学生收费，家长账号免费。不自动续费。项目数量与 AI
          交互额度分别计算。年卡和规模化机构套餐保持条件性方案。
        </p>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>购买与免费入口</h2>
          <span className={`tag ${data.catalog.purchasing.available ? 'succeeded' : ''}`}>
            {data.catalog.purchasing.available ? '可购买' : '待开放'}
          </span>
        </div>
        <p>{data.catalog.purchasing.reason}</p>
        <p className="muted">
          售卖前需要有效的教学目录、经营条款与微信商户配置。体验课请选择独立短课版本，不能用完整课程的前半段替代。
        </p>
        <label>
          免费入门课程（每生最多 1 个体验项目）
          <select
            multiple
            value={free}
            onChange={(e) => setFree([...e.target.selectedOptions].map((o) => o.value))}
          >
            {data.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} · {t.version}
              </option>
            ))}
          </select>
        </label>
        <div className="form-footer">
          <a href="/admin/business">经营主体与支付配置 ↗</a>
          <button
            disabled={busy || !data.actor.admin}
            onClick={() =>
              void act(
                'admin/subscriptions/policy',
                {
                  ...data.catalog.policy,
                  freeTemplateVersionIds: free,
                  enabled: !data.catalog.policy.enabled,
                },
                'PATCH',
              )
            }
          >
            {data.catalog.policy.enabled ? '暂停订阅策略' : '保存并启用订阅策略'}
          </button>
        </div>
      </section>
      <div className="product-grid">
        {data.catalog.products.map((p) => (
          <ProductEditor key={`${p.id}:${p.revision}`} {...props} product={p} />
        ))}
      </div>
    </>
  );
}
function ProductEditor({ product: p, data, busy, act }: PanelProps & { product: CommerceProduct }) {
  const [ids, setIds] = useState(p.templateVersionIds),
    [status, setStatus] = useState(p.status);
  const conditional = ['year', 'institution', 'school'].includes(p.id);
  return (
    <article className="panel product">
      <div className="panel-title">
        <span className="eyebrow">{p.id.toUpperCase()}</span>
        <span className={`tag ${p.status === 'published' ? 'succeeded' : ''}`}>
          {
            { published: '已发布', draft: '草稿', conditional: '条件性方案', archived: '已下架' }[
              p.status
            ]
          }
        </span>
      </div>
      <h2>{p.title}</h2>
      <div className="price">
        {money(p.priceFen)}
        <small>{p.months ? ` / ${p.months === 1 ? '月' : '年'}` : ` / ${p.days} 天`}</small>
      </div>
      {p.seatPriceFen > 0 && (
        <p>
          另加 {money(p.seatPriceFen)} / 学生 / 年，{p.seats} 人起
        </p>
      )}
      <p className="muted">{p.summary}</p>
      <dl className="product-facts">
        <div>
          <dt>交互额度</dt>
          <dd>
            {p.quota} 次 / {p.months ? '月' : '有效期'}
          </dd>
        </div>
        <div>
          <dt>项目</dt>
          <dd>{p.projectLimit === null ? '目录内不限数量' : `每生最多 ${p.projectLimit} 个`}</dd>
        </div>
      </dl>
      <label>
        课程版本目录
        <select
          multiple
          value={ids}
          onChange={(e) => setIds([...e.target.selectedOptions].map((o) => o.value))}
          disabled={!data.actor.admin}
        >
          {data.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} · {t.version}
            </option>
          ))}
        </select>
      </label>
      {!data.templates.length && (
        <p className="muted">暂无已发布且绑定有效的课程，请先在 Admin 完成教学配置。</p>
      )}
      <div className="form-row">
        <label>
          发布状态
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CommerceProduct['status'])}
          >
            <option value="draft">草稿</option>
            <option value="published" disabled={conditional}>
              发布
            </option>
            <option value="conditional">条件性方案</option>
            <option value="archived">下架</option>
          </select>
        </label>
        <button
          disabled={busy || !data.actor.admin}
          onClick={() =>
            void act(
              'admin/subscriptions/products',
              { id: p.id, revision: p.revision, templateVersionIds: ids, status },
              'PATCH',
            )
          }
        >
          保存产品
        </button>
      </div>
    </article>
  );
}
export function FinancePanel({ detail, data, act, busy }: PanelProps) {
  const report = detail as BusinessDashboard | null;
  if (!report) return <div className="panel empty">财务明细需要经营操作权限。</div>;
  return (
    <>
      <div className="metrics-strip">
        {[
          ['实收', report.metrics.revenueFen],
          ['已退款', report.metrics.refundedFen],
          ['记录成本', report.metrics.recordedExpenseFen],
          [
            '收支差额',
            report.metrics.revenueFen -
              report.metrics.refundedFen -
              report.metrics.recordedExpenseFen,
          ],
        ].map(([name, value]) => (
          <article key={name}>
            <span>{name}</span>
            <strong>{money(Number(value))}</strong>
            <small>累计 · 不等于已核算利润</small>
          </article>
        ))}
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>订单与退款</h2>
          <a href="/company/customers">客户跟进 ↗</a>
        </div>
        <OrderTable
          orders={report.recentOrders}
          renderAction={(o) =>
            o.status === 'refund_requested' && data.actor.admin ? (
              <button
                disabled={busy}
                className="secondary"
                onClick={() => void act(`company/orders/${o.id}/refund`, {})}
              >
                退款 {money(o.refundAmountFen ?? o.amountFen)}
              </button>
            ) : null
          }
        />
      </section>
      <section className="panel">
        <h2>成本记录</h2>
        {!report.expenses.length ? (
          <div className="empty">尚无成本记录，不能据此认定运营成本为零。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>类别</th>
                  <th>金额</th>
                  <th>说明</th>
                  <th>记录时间</th>
                </tr>
              </thead>
              <tbody>
                {report.expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{e.category}</td>
                    <td>{money(e.amountFen)}</td>
                    <td>{e.note}</td>
                    <td>{date(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ExpenseEntry report={report} act={act} busy={busy} />
    </>
  );
}
function OrderTable({
  orders,
  renderAction,
}: {
  orders: Omit<BusinessOrder, 'terms' | 'checkoutUrl'>[];
  renderAction?: (o: Omit<BusinessOrder, 'terms' | 'checkoutUrl'>) => React.ReactNode;
}) {
  return orders.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>产品与订单</th>
            <th>实付</th>
            <th>状态</th>
            <th>服务有效期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <strong>{o.subscription?.product.title ?? o.offer?.title ?? '历史课程'}</strong>
                <small className="block">{o.id}</small>
                {!!o.subscription?.discountFen && (
                  <small className="block">体验抵扣 {money(o.subscription.discountFen)}</small>
                )}
              </td>
              <td>{money(o.amountFen)}</td>
              <td>{businessOrderLabel(o.status)}</td>
              <td>
                {date(o.serviceStartsAt)}
                <br />至 {date(o.accessUntil)}
              </td>
              <td>{renderAction?.(o)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty">暂无订单。用户付款后，支付回执和开通状态会在这里汇总。</div>
  );
}
interface Organizations {
  leads?: BusinessDashboard['leads'];
  organizations: { id: string; name: string }[];
  orders: BusinessOrder[];
  seats: {
    id: string;
    orderId: string;
    studentId: string;
    endsAt: string;
    revokedAt: string | null;
  }[];
}
export function CustomersPanel({ detail, data, act, busy }: PanelProps) {
  const rows = detail as Organizations | null;
  const [name, setName] = useState(''),
    [organizationId, setOrganizationId] = useState(''),
    [orderId, setOrderId] = useState(''),
    [studentId, setStudentId] = useState(''),
    [agreed, setAgreed] = useState(false);
  const pilot = data.catalog.products.find((p) => p.id === 'pilot')!;
  if (!rows) return <div className="panel empty">机构明细需要经营操作权限。</div>;
  return (
    <>
      <CustomerLeads leads={rows.leads ?? []} act={act} busy={busy} />
      <div className="split-grid">
        <section className="panel">
          <h2>登记机构客户</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act('company/organizations', { name });
            }}
          >
            <label>
              机构名称
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button disabled={busy || !data.actor.admin}>登记机构</button>
          </form>
        </section>
        <section className="panel">
          <h2>开通 30 天试点</h2>
          <p className="muted">{money(pilot.priceFen)} · 30 名学生 · 指定课程 · 每生 100 次交互</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act('company/orders', {
                productId: 'pilot',
                productRevision: pilot.revision,
                settingsRevision: data.catalog.settingsRevision,
                organizationId,
                seats: 30,
                acceptedTerms: true,
                guardianConsent: true,
              });
            }}
          >
            <label>
              机构
              <select
                required
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
              >
                <option value="">选择已登记机构</option>
                {rows.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              已确认合同、服务条款及学生授权安排
            </label>
            <button
              disabled={
                busy ||
                !agreed ||
                !data.actor.admin ||
                !data.catalog.purchasing.available ||
                pilot.status !== 'published'
              }
            >
              创建试点订单
            </button>
          </form>
        </section>
      </div>
      <section className="panel">
        <h2>机构订单</h2>
        <OrderTable
          orders={rows.orders}
          renderAction={(o) => (
            <div className="button-stack">
              {o.status === 'pending' && (
                <button
                  className="secondary"
                  disabled={busy || !data.actor.admin}
                  onClick={() => void act(`company/orders/${o.id}/checkout`, {})}
                >
                  微信付款码
                </button>
              )}
              <button
                className="text-button"
                disabled={busy || !data.actor.admin}
                onClick={() => void act(`company/orders/${o.id}/reconcile`, {})}
              >
                核对付款状态
              </button>
            </div>
          )}
        />
        {rows.orders
          .filter((o) => o.checkoutUrl && o.status === 'pending')
          .map((o) => (
            <div className="payment-box" key={o.id}>
              <PaymentCode value={o.checkoutUrl!} />
              <p>
                微信扫一扫支付 {money(o.amountFen)}
                <br />
                <small>订单 {o.id}</small>
              </p>
            </div>
          ))}
      </section>
      <section className="panel">
        <h2>分配学生席位</h2>
        <p className="muted">
          合同支付成功后可分配。每个席位对应一个学生；分配不改变教师权限或教学门禁。
        </p>
        <form
          className="work-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act('company/seats', { orderId, studentId });
          }}
        >
          <label>
            有效合同
            <select required value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">选择已支付合同</option>
              {rows.orders
                .filter((o) => o.status === 'paid')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {
                      rows.organizations.find((org) => org.id === o.subscription?.organizationId)
                        ?.name
                    }{' '}
                    · {o.id.slice(-8)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            学生账号 ID
            <input
              required
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              maxLength={100}
            />
          </label>
          <button disabled={busy || !data.actor.admin}>分配席位</button>
        </form>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>学生</th>
                <th>合同</th>
                <th>到期</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.seats.map((s) => (
                <tr key={s.id}>
                  <td>{s.studentId}</td>
                  <td>{s.orderId.slice(-8)}</td>
                  <td>{date(s.endsAt)}</td>
                  <td>
                    {s.revokedAt ? '已撤销' : new Date(s.endsAt) < new Date() ? '已到期' : '已分配'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.seats.length && <div className="empty">尚未分配学生席位。</div>}
      </section>
    </>
  );
}
export function KnowledgePanel({ data, detail, act, busy }: PanelProps) {
  const rows = (detail ?? []) as {
    id: string;
    title: string;
    content: string;
    revision: number;
    updatedAt: string;
  }[];
  const [title, setTitle] = useState(''),
    [content, setContent] = useState('');
  return (
    <>
      <section className="panel">
        <h2>沉淀公司知识</h2>
        <p className="muted">
          保存服务流程、产品说明和经营决策。此处内容不会自动扩大助手或学生的知识库权限。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act('company/knowledge', { title, content, revision: 0 });
          }}
        >
          <label>
            标题
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            内容
            <textarea
              required
              rows={6}
              maxLength={20000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <button disabled={busy || !['owner', 'operator'].includes(data.role)}>保存知识</button>
        </form>
      </section>
      <section className="panel">
        <h2>知识目录</h2>
        {rows.map((r) => (
          <details key={r.id}>
            <summary>
              {r.title}{' '}
              <small>
                v{r.revision} · {date(r.updatedAt)}
              </small>
            </summary>
            <pre className="result">{r.content}</pre>
          </details>
        ))}
        {!rows.length && <div className="empty">还没有知识条目。从一份可复用的服务流程开始。</div>}
      </section>
    </>
  );
}
interface Integrations {
  members?: { userId: string; name: string; role: string; active: boolean }[];
  channels: {
    id: string;
    assistantId: string;
    appId: string;
    chatId: string;
    userId: string;
    department: string;
    active: boolean;
  }[];
  bots: {
    assistantId: string;
    appId: string | null;
    enabled: boolean;
    inboundEnabled: boolean;
    bridge: { state: string; errorCode?: string };
  }[];
}
export function IntegrationsPanel({ detail, data, act, busy }: PanelProps) {
  const rows = detail as Integrations | null;
  const [form, setForm] = useState({
    assistantId: '',
    appId: '',
    chatId: '',
    senderOpenId: '',
    userId: data.actor.id,
    department: 'management',
    active: true,
  });
  if (!rows) return <div className="panel empty">飞书绑定需要公司所有者权限。</div>;
  return (
    <>
      <div className="callout">
        <strong>把公司助手加入你的飞书团队</strong>
        <p>
          先在 Admin
          配置并启用飞书应用机器人，再绑定群、发送人和公司账号。群里只接收任务状态，工作成果在
          Company 内查看。
        </p>
        <a href="/admin">打开助手与飞书配置 ↗</a>
      </div>
      <section className="panel">
        <h2>应用连接</h2>
        {rows.bots.map((b) => (
          <div className="connection" key={b.assistantId}>
            <div>
              <strong>{b.assistantId}</strong>
              <small className="block">{b.appId ?? '未配置应用'}</small>
            </div>
            <span className={`tag ${b.bridge.state === 'connected' ? 'succeeded' : ''}`}>
              {b.bridge.state}
            </span>
            <span>{b.bridge.errorCode}</span>
          </div>
        ))}
        {!rows.bots.length && <div className="empty">尚未配置飞书应用机器人。</div>}
      </section>
      <section className="panel">
        <h2>绑定群与操作人</h2>
        <form
          className="work-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act('company/integrations/feishu', form);
          }}
        >
          <label>
            应用机器人
            <select
              required
              value={form.assistantId}
              onChange={(e) => {
                const bot = rows.bots.find((b) => b.assistantId === e.target.value);
                setForm({ ...form, assistantId: e.target.value, appId: bot?.appId ?? '' });
              }}
            >
              <option value="">选择已配置机器人</option>
              {rows.bots.map((b) => (
                <option key={b.assistantId} value={b.assistantId}>
                  {b.assistantId}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ['chatId', '群 Chat ID'],
              ['senderOpenId', '发送人 Open ID'],
              ['userId', '对应公司用户 ID'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required
                maxLength={256}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            委派部门
            <select
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            >
              {COMPANY_DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            绑定状态
            <select
              value={String(form.active)}
              onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}
            >
              <option value="true">启用</option>
              <option value="false">撤销</option>
            </select>
          </label>
          <div className="wide form-footer">
            <small>
              群命令：<code>/company {form.department} 请整理本周运营建议</code>
            </small>
            <button disabled={busy || data.role !== 'owner'}>保存绑定</button>
          </div>
        </form>
      </section>
      <section className="panel">
        <h2>群绑定记录</h2>
        {rows.channels.map((c) => (
          <div className="connection" key={c.id}>
            <div>
              <strong>{c.chatId}</strong>
              <small className="block">
                {c.userId} → {COMPANY_DEPARTMENTS.find((d) => d.id === c.department)?.name}
              </small>
            </div>
            <span className="tag">{c.active ? '已授权' : '已撤销'}</span>
          </div>
        ))}
        {!rows.channels.length && (
          <div className="empty">暂无群绑定。加入群不会自动授予公司权限。</div>
        )}
      </section>
      <CompanyMembers members={rows.members ?? []} act={act} busy={busy} />
    </>
  );
}

function CompanyMembers({
  members,
  act,
  busy,
}: {
  members: NonNullable<Integrations['members']>;
  act: PanelProps['act'];
  busy: boolean;
}) {
  const [userId, setUserId] = useState(''),
    [role, setRole] = useState('operator'),
    [active, setActive] = useState(true);
  return (
    <section className="panel">
      <h2>公司成员与权限</h2>
      <p className="muted">
        只授予公司工作区权限，不改变原账号的平台角色。学生账号不能加入公司工作区。
      </p>
      <form
        className="work-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act('company/members', { userId, role, active }, 'PATCH');
        }}
      >
        <label>
          已有账号 ID
          <input
            required
            maxLength={100}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </label>
        <label>
          公司角色
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="owner">所有者 · 配置与经营</option>
            <option value="operator">运营 · 工作与明细</option>
            <option value="analyst">分析 · 汇总与成果</option>
            <option value="viewer">观察 · 汇总与成果</option>
          </select>
        </label>
        <label>
          成员状态
          <select value={String(active)} onChange={(e) => setActive(e.target.value === 'true')}>
            <option value="true">启用</option>
            <option value="false">撤销</option>
          </select>
        </label>
        <div className="form-footer">
          <button disabled={busy}>保存成员权限</button>
        </div>
      </form>
      {members.map((m) => (
        <div className="connection" key={m.userId}>
          <div>
            <strong>{m.name}</strong>
            <small className="block">{m.userId}</small>
          </div>
          <span>{m.role}</span>
          <span className="tag">{m.active ? '有效' : '已撤销'}</span>
        </div>
      ))}
    </section>
  );
}
