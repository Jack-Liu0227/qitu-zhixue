export function RadarChart({
  data,
  maxWidth = 280,
}: {
  data: { label: string; value: number }[];
  maxWidth?: number;
}) {
  const center = 100;
  const radius = 56;
  const labelRadius = 78;
  const step = 360 / data.length;

  const axes = data.map((_, i) => {
    const rad = (Math.PI / 180) * (i * step - 90);
    return { x: center + radius * Math.cos(rad), y: center + radius * Math.sin(rad) };
  });
  const valuePoints = data.map((item, i) => {
    const rad = (Math.PI / 180) * (i * step - 90);
    const r = radius * (item.value / 100);
    return `${center + r * Math.cos(rad)},${center + r * Math.sin(rad)}`;
  });

  return (
    <svg
      viewBox="0 0 200 200"
      style={{ width: '100%', maxWidth, height: 'auto', display: 'block', margin: '0 auto' }}
    >
      {[0.33, 0.66, 1].map((scale) => (
        <polygon
          key={scale}
          points={axes.map((a) => `${center + (a.x - center) * scale},${center + (a.y - center) * scale}`).join(' ')}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
      ))}
      {axes.map((a, i) => (
        <line key={i} x1={center} y1={center} x2={a.x} y2={a.y} stroke="#e2e8f0" strokeWidth="1" />
      ))}
      <polygon
        points={valuePoints.join(' ')}
        fill="rgba(37,99,235,.16)"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {valuePoints.map((p, i) => {
        const [x, y] = p.split(',').map(Number);
        return <circle key={i} cx={x} cy={y} r="3.5" fill="#2563eb" />;
      })}
      {data.map((item, i) => {
        const rad = (Math.PI / 180) * (i * step - 90);
        const x = center + labelRadius * Math.cos(rad);
        const y = center + labelRadius * Math.sin(rad);
        return (
          <text
            key={item.label}
            x={x}
            y={y}
            fontSize="10"
            fill="#64748b"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {item.label}
          </text>
        );
      })}
    </svg>
  );
}
