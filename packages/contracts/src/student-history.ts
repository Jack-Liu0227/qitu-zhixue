export type StudentHistoryDeleteKind = 'project' | 'exploration' | 'plan' | 'conversation';
export interface StudentHistoryDeleteReceipt {
  id: string;
  kind: StudentHistoryDeleteKind;
  deleted: true;
  replayed: boolean;
}
export interface StudentConversationHistoryItem {
  id: string;
  title: string;
  kind: 'project' | 'exploration';
  projectId?: string;
  explorationId?: string;
  updatedAt: string;
  turnCount: number;
  stageLabel?: string;
}
