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
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
}
