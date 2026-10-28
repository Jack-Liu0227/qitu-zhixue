'use client';
import { useState } from 'react';
import type { BusinessDashboard, BusinessLead } from '@qitu/contracts';
import type { CompanyAction } from './CompanyWorkspace';
import { date } from './api';
export function CustomerLeads({
  leads,
  act,
  busy,
}: {
  leads: BusinessLead[];
  act: CompanyAction;
  busy: boolean;
}) {
  return (
    <section className="panel">
      <h2>咨询与客户跟进</h2>
      <p className="muted">公开站点收到的咨询，统一跟踪处理状态。</p>
      {leads.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>客户</th>
                <th>联系方式</th>
                <th>需求</th>
                <th>收到时间</th>
                <th>跟进状态</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.name}
                    <small className="block">{l.identity}</small>
                  </td>
                  <td>{l.phone}</td>
                  <td>{l.message ?? '—'}</td>
                  <td>{date(l.createdAt)}</td>
                  <td>
                    <select
                      aria-label={`${l.name}的跟进状态`}
                      value={l.status}
                      disabled={busy}
                      onChange={(e) =>
                        void act(`company/leads/${l.id}`, { status: e.target.value }, 'PATCH')
                      }
                    >
                      <option value="received">待跟进</option>
                      <option value="contacted">已联系</option>
                      <option value="closed">已结案</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">尚未收到咨询。</div>
      )}
    </section>
  );
}
export function ExpenseEntry({
  report,
  act,
  busy,
}: {
  report: BusinessDashboard;
  act: CompanyAction;
  busy: boolean;
}) {
  const [category, setCategory] = useState('ai'),
    [amount, setAmount] = useState(''),
    [minutes, setMinutes] = useState(0),
    [note, setNote] = useState(''),
    [orderId, setOrderId] = useState('');
  return (
    <section className="panel">
      <h2>记录经营成本</h2>
      <form
        className="work-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^\d{1,6}(\.\d{1,2})?$/.test(amount)) return;
          const [whole, part] = amount.split('.');
          void act('company/expenses', {
            category,
            amountFen: Number(whole) * 100 + Number((part ?? '').padEnd(2, '0')),
            minutes,
            note,
            orderId: orderId || null,
          });
        }}
      >
        <label>
          成本类型
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="ai">模型服务</option>
            <option value="payment">支付费用</option>
            <option value="hosting">服务器</option>
            <option value="support">客户服务</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          金额（元）
          <input
            required
            inputMode="decimal"
            pattern="[0-9]{1,6}(\.[0-9]{1,2})?"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="例如 19.90"
          />
        </label>
        <label>
          投入时间（分钟）
          <input
            type="number"
            min={0}
            max={100000}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
        <label>
          关联订单（可选）
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">平台共同成本</option>
            {report.recentOrders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.subscription?.product.title ?? o.offer?.title} · {o.id.slice(-8)}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          费用说明
          <input required maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="wide form-footer">
          <small>手动记录真实账单或工时，不自动估算成本。</small>
          <button disabled={busy}>保存成本</button>
        </div>
      </form>
    </section>
  );
}
