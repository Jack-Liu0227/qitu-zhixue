import type { ProjectStage } from './project.js';

export interface ProjectHistoryItem {
  kind: 'project' | 'exploration' | 'plan';
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  status: ProjectStage;
  templateVersionId: string;
  coverAssetId?: string | null;
  currentStageIndex: number;
  stageTotal: number;
  progressPercent: number;
  createdAt: string;
  lastLearningActivityAt: string | null;
  collectedAt: string | null;
  isCurrent: boolean;
}
export interface ProjectHistoryPage {
  items: ProjectHistoryItem[];
  nextCursor: string | null;
  counts: Record<'active' | 'draft' | 'done', number>;
  revision: string;
  preferenceVersion: number;
  currentProjectId: string | null;
  selectionSource: 'explicit' | 'creation_fallback' | 'none';
}
export interface ProjectDisplayChange {
  expectedVersion: number;
  collected?: boolean;
  /** Required when collecting the selected project. Null explicitly clears it. */
  currentProjectId?: string | null;
}
