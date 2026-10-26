import type { PblTemplateStatus } from './pbl-learning.js';
import type { PblBindingStatus } from './project-binding.js';

export interface AdminTeamTemplateReference {
  templateId: string;
  templateTitle: string;
  templateStatus: PblTemplateStatus;
  templateVersionId: string;
  version: string;
  versionStatus: PblTemplateStatus;
  linkedInTemplate: boolean;
  bindings: Array<{ id: string; status: PblBindingStatus; projectCount: number }>;
}

export interface AdminTeamTemplateUsage {
  teamId: string;
  teamUpdatedAt: string;
  templates: AdminTeamTemplateReference[];
  templateCount: number;
  bindingCount: number;
  projectCount: number;
}
