'use client';
import { useState } from 'react';
import { businessRequest } from '@qitu/api-client';
import {
  formatBusinessMoney,
  type BusinessDashboard,
  type CreateBusinessExpense,
} from '@qitu/contracts';
import type { BusinessAction } from './BusinessWorkspace';
import styles from './business.module.css';

const CATEGORIES: { id: CreateBusinessExpense['category']; label: string }[] = [
  { id: 'ai', label: '模型与检索账单' },
  { id: 'payment', label: '支付手续费' },
  { id: 'hosting', label: '服务器与存储' },
  { id: 'support', label: '客服与交付' },
  { id: 'other', label: '其他经营成本' },
];

export function BusinessExpenseForm({
  data,
  disabled,
  act,
}: {
  data: BusinessDashboard;
  disabled: boolean;
  act: BusinessAction;
}) {
  const [category, setCategory] = useState<CreateBusinessExpense['category']>('ai');
  const [amount, setAmount] = useState('');
  const [minutes, setMinutes] = useState('0');
  const [note, setNote] = useState('');
  const [orderId, setOrderId] = useState('');
  return (
    <section className={styles.panel} style={{ marginTop: 20 }}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>经营成本与时间账</h2>
          <p>
            已记录成本 {formatBusinessMoney(data.metrics.recordedExpenseFen)}，人工投入{' '}
            {data.metrics.supportMinutes} 分钟。
          </p>
        </div>
        <span className={styles.tag}>按实际账单记录</span>
      </div>
      <p className={styles.note}>
        实收扣退款及已记录成本后结余{' '}
        {formatBusinessMoney(
          data.metrics.revenueFen - data.metrics.refundedFen - data.metrics.recordedExpenseFen,
        )}
        。尚未登记的账单和时间不在此数值中。
      </p>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          const body: CreateBusinessExpense = {
            category,
            amountFen: Math.round(Number(amount) * 100),
            minutes: Number(minutes),
            note,
            orderId: orderId || null,
          };
          void act(`expense:${JSON.stringify(body)}`, (key) =>
            businessRequest('admin/business/expenses', { method: 'POST', key, body }),
          );
        }}
      >
        <div className={styles.columns}>
          <label className={styles.field}>
            成本类别
            <select
              value={category}
              onChange={(e) => {
                const next = CATEGORIES.find((c) => c.id === e.target.value);
                if (next) setCategory(next.id);
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            金额，元
            <input
              required
              type="number"
              min={0}
              max={1000000}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        </div>
        <div className={styles.columns}>
          <label className={styles.field}>
            人工投入，分钟
            <input
              type="number"
              min={0}
              max={100000}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            关联订单，可选
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">平台共同成本</option>
              {data.recentOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.subscription?.product.title ?? o.offer?.title ?? '历史课程'} · {o.id.slice(-8)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={styles.field}>
          说明
          <input
            required
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：本月供应商账单，不填写密钥或学生对话"
          />
        </label>
        <div className={styles.formFooter}>
          <p>每条记录会保留审计，用于成本核对。</p>
          <button className={styles.primary} disabled={disabled} type="submit">
            记录成本与时间
          </button>
        </div>
      </form>
      <details>
        <summary>最近成本记录</summary>
        {!data.expenses.length && <p className={styles.empty}>尚未登记成本。请按实际账单记录。</p>}
        {data.expenses.map((cost) => (
          <div className={styles.row} key={cost.id}>
            <div>
              <strong>{cost.note}</strong>
              <small>
                {CATEGORIES.find((c) => c.id === cost.category)?.label} · {cost.minutes} 分钟 ·{' '}
                {new Date(cost.createdAt).toLocaleDateString('zh-CN')}
              </small>
            </div>
            <span className={styles.money}>{formatBusinessMoney(cost.amountFen)}</span>
          </div>
        ))}
      </details>
    </section>
  );
}
