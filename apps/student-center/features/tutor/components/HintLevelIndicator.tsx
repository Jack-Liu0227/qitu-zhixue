import type { TutorHintLevel } from '@qitu/contracts';
import { EXPLAIN_ONLY_LEVEL, HINT_LEVEL_MAX, HINT_LEVEL_MIN } from '../pedagogy';

const LEVEL_NAMES: Record<TutorHintLevel, string> = {
  1: '启发思考',
  2: '思考方向',
  3: '关键线索',
  4: '步骤示范',
  5: '概念解析',
};

/**
 * 教学启发提示徽标。
 * 移除冗余固定的 1-5 阶梯数字方块，展示语义清晰的启发提示。
 */
export function HintLevelIndicator({ level }: { level: TutorHintLevel }) {
  const clamped = Math.min(Math.max(level, HINT_LEVEL_MIN), HINT_LEVEL_MAX) as TutorHintLevel;
  return (
    <div className="qitu-hint-indicator" aria-label={`启发提示 · ${LEVEL_NAMES[clamped]}`}>
      <span className="qitu-hint-badge">
        💡 {LEVEL_NAMES[clamped]}
        {clamped === EXPLAIN_ONLY_LEVEL ? '（深度解析）' : ''}
      </span>
    </div>
  );
}
