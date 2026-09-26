import { colors } from '@qitu/design-tokens';

import type { TodaySuggestion } from '../types';

/**
 * Module-local AI suggestion card. `@qitu/ui` does not export
 * `SuggestionCard` yet (Wave 3 unavailable list). The suggestion is a
 * server-computed AI decision: it is rendered read-only with no edit control.
 */
export function SuggestionCard({ suggestion }: { suggestion: TodaySuggestion }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 12,
        borderRadius: 12,
        background: colors.page,
        border: `1px solid ${colors.border}`,
      }}
    >
      <strong style={{ color: colors.heading }}>{suggestion.title}</strong>
      <p style={{ margin: 0, color: colors.text, fontSize: 14 }}>{suggestion.body}</p>
    </div>
  );
}
