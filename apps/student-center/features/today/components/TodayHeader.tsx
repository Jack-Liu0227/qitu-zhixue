import { colors } from '@qitu/design-tokens';

/**
 * Page-level 「今天」 heading block. This is NOT the banner — the greeting
 * banner lives in the shell slot (`TodayGreetingBanner`).
 */
export function TodayHeader({ date }: { date: string }) {
  const formatted = formatDate(date);
  return (
    <header className="qitu-today-header" style={{ color: colors.heading }}>
      <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>今天</h1>
      {formatted ? (
        <p style={{ margin: '4px 0 0', color: colors.muted, fontSize: 14 }}>{formatted}</p>
      ) : null}
    </header>
  );
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日` : value;
}
