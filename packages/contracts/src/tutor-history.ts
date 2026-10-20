import type { TutorTeamAgentToolCall } from './tutor.js';

export interface TutorTeamHistoryEntry {
  id: string;
  kind: 'conversation' | 'collaboration' | 'tool';
  occurredAt: string;
  summary: string;
  toolCalls: TutorTeamAgentToolCall[];
}

export interface TutorTeamHistoryPage {
  projectId: string;
  assistantId: string;
  items: TutorTeamHistoryEntry[];
  nextCursor: string | null;
}
