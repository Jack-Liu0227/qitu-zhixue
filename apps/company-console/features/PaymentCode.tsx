'use client';
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
export function PaymentCode({ value }: { value: string }) {
  const qr = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const n = code.getModuleCount(),
      cells = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (code.isDark(y, x)) cells.push(`M${x + 4},${y + 4}h1v1h-1z`);
    return { n: n + 8, path: cells.join('') };
  }, [value]);
  return (
    <svg
      className="qr"
      role="img"
      aria-label="微信支付二维码"
      viewBox={`0 0 ${qr.n} ${qr.n}`}
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="white" />
      <path d={qr.path} fill="#172e32" />
    </svg>
  );
}
