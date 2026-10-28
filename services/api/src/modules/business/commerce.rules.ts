import type { CommerceProduct } from '@qitu/contracts';
const DAY = 86_400_000;
/** Calendar arithmetic in Asia/Shanghai; preserve the original anchor across cycles. */
export function addCommerceMonths(value: Date, months: number): Date {
  const local = new Date(value.getTime() + 8 * 3_600_000);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + months);
  const last = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return new Date(local.getTime() - 8 * 3_600_000);
}
export function commerceEnd(start: Date, product: Pick<CommerceProduct, 'months' | 'days'>) {
  return product.months
    ? addCommerceMonths(start, product.months)
    : new Date(start.getTime() + product.days * DAY);
}
export function commerceCycle(start: Date, end: Date, monthly: boolean, now: Date) {
  let from = start;
  let until = end;
  if (monthly) {
    for (let i = 1; i <= 12; i++) {
      const next = addCommerceMonths(start, i);
      if (next > now || next >= end) {
        until = new Date(Math.min(next.getTime(), end.getTime()));
        break;
      }
      from = next;
    }
  }
  return { from, until };
}
export function freeCommerceCycle(now: Date) {
  const date = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const from = new Date(date + 'T00:00:00+08:00');
  return { from, until: new Date(from.getTime() + DAY) };
}
export function refundableFen(amount: number, start: Date, end: Date, at: Date) {
  if (at <= start) return amount;
  if (at >= end) return 0;
  return Math.floor((amount * (end.getTime() - at.getTime())) / (end.getTime() - start.getTime()));
}
