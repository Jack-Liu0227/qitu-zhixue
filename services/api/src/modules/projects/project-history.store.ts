import type { ProjectHistoryItem, ProjectDisplayChange } from '@qitu/contracts';
import type { AuditTransaction } from '../../common/audit/audit.service';

export interface ProjectHistoryQuery {
  tab: 'active' | 'draft' | 'done' | 'all'; q: string; includeCollected: boolean; limit: number;
  after?: { createdAt: string; id: string; kind: string }; revision?: string;
}
export interface ProjectHistorySnapshot {
  items: ProjectHistoryItem[]; revision: string; counts: Record<'active' | 'draft' | 'done', number>;
  version: number; currentProjectId: string | null;
  recommendedProjectId: string | null;
  /** Preserve PostgreSQL microseconds for keyset comparison; never use JS Date precision here. */
  paginationKeys: Record<string,string>;
}
export abstract class ProjectHistoryStore {
  abstract query(studentId: string, query: ProjectHistoryQuery): Promise<ProjectHistorySnapshot>;
  abstract change(studentId: string, projectId: string | null, input: ProjectDisplayChange, commit?: (tx:AuditTransaction)=>Promise<void>): Promise<{ version: number; currentProjectId: string | null; collectedAt: string | null }>;
}
