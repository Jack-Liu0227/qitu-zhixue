import type { GrowthObservationState } from '../types';

/**
 * 「待观察」提示——当一条结论没有证据支撑时展示。
 *
 * 这是「证据不足不得填 0」这条产品规则的界面落点：只要服务端推导出
 * `pending_observation`，这里就明确说明「还没有足够证据」，而**不是**显示 0
 * 分、负面结论或任何默认判定。有证据（`observed`）时组件不渲染。
 */
export function ObservationNote({ state }: { state: GrowthObservationState }) {
  if (state !== 'pending_observation') {
    return null;
  }

  return (
    <p className="qitu-observation-note" role="note">
      <span className="qitu-observation-badge">待观察</span>
      <span className="qitu-observation-note-text">
        这条结论还没有足够的证据，先留作观察，不急着下结论。
      </span>
    </p>
  );
}
