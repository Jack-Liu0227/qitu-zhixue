import type { ReactNode } from 'react';

type MetricCardProps = {
  label: string;
  value: string;
  delta?: ReactNode;
  icon: ReactNode;
  tone?: string;
};

export function MetricCard({ label, value, delta, icon, tone = '#2563eb' }: MetricCardProps) {
  return (
    <div className="qtx-metric">
      <div className="qtx-metric-icon" style={{ background: `${tone}14`, color: tone }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="qtx-metric-label">{label}</div>
        <div className="qtx-metric-value">{value}</div>
        {delta ? <div className="qtx-metric-delta">{delta}</div> : null}
      </div>
    </div>
  );
}
