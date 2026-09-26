import { SectionCard } from '@qitu/ui';

import type { TodaySuggestion } from '../types';
import { SuggestionCard } from './SuggestionCard';

/**
 * 「AI搭档建议」(Q3 pending endpoint). Renders the server-computed AI
 * suggestion read-only; there is no client write path for AI decisions.
 */
export function AiSuggestionCard({ suggestion }: { suggestion: TodaySuggestion | null }) {
  if (!suggestion) return null;
  return (
    <SectionCard title="AI搭档建议">
      <SuggestionCard suggestion={suggestion} />
    </SectionCard>
  );
}
