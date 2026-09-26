import type { TutorHintLevel } from '@qitu/contracts';
import { EXPLAIN_ONLY_LEVEL, HINT_LEVEL_MAX, HINT_LEVEL_MIN } from '../pedagogy';

const LEVEL_NAMES: Record<TutorHintLevel, string> = {
  1: '提问',
  2: '思考方向',
  3: '关键线索',
  4: '部分示范',
  5: '必要解释',
};

const LEVELS: TutorHintLevel[] = [1, 2, 3, 4, 5];

/**
 * Visible hint ladder (1–5).
 *
 * The indicator only reflects the server's `hint_level`; it never computes or
 * writes one. Level 5 (必要解释) is marked as `explain`-only because the
 * spec makes 「解释这个概念」 the single entry that may reach it — any other
 * move producing level 5 is a P0 violation checked server-side.
 */
export function HintLevelIndicator({ level }: { level: TutorHintLevel }) {
  const clamped = Math.min(Math.max(level, HINT_LEVEL_MIN), HINT_LEVEL_MAX) as TutorHintLevel;
  return (
    <div className="qitu-hint-indicator" aria-label={`提示等级 ${clamped} / ${HINT_LEVEL_MAX}`}>
      <div className="qitu-hint-track">
        {LEVELS.map((step) => {
          const reached = step <= clamped;
          const explainOnly = step === EXPLAIN_ONLY_LEVEL;
          return (
            <span
              key={step}
              className={[
                'qitu-hint-step',
                reached ? 'is-reached' : '',
                explainOnly ? 'is-explain-only' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={`${step} ${LEVEL_NAMES[step]}${explainOnly ? '（仅解释这个概念可达）' : ''}`}
            >
              {step}
            </span>
          );
        })}
      </div>
      <span className="qitu-hint-name">
        第 {clamped} 档 · {LEVEL_NAMES[clamped]}
        {clamped === EXPLAIN_ONLY_LEVEL ? '（仅「解释这个概念」可达）' : ''}
      </span>
    </div>
  );
}
