import type { ProjectTemplateSpec } from '@qitu/contracts';
export type { TeachingBundleDraft } from '@qitu/contracts';

export const TEACHING_BUNDLE_SCHEMA_VERSION = 'qitu.teaching-bundle.v1' as const;
export const TEACHING_BUNDLE_COMPILER_VERSION = '1.0.0' as const;
export const TEACHING_PURPOSES = ['outline', 'session', 'dialogue'] as const;
export type TeachingPurpose = (typeof TEACHING_PURPOSES)[number];

export interface TeachingSkillPin {
  canonicalId: string;
  version: string;
  packageDigest: string;
}

/** Resolved by the reviewed artifact owner, not supplied by a model or browser. */
export interface ReviewedTeachingSkill extends TeachingSkillPin {
  status: 'quarantined' | 'reviewed' | 'published' | 'deprecated' | 'revoked';
  runtime: 'teaching' | 'dev-only';
  requiredToolIds: readonly string[];
}

export interface TeachingModelPair {
  modelProviderId: string;
  modelId: string;
}

export interface TeachingModelSelection extends TeachingModelPair {
  policyVersion: string;
}

export interface TeachingToolArtifact {
  toolId: string;
  schemaDigest: string;
  handlerVersion: string;
  mcpServerId: string | null;
}

export interface TeachingAssistantSource {
  assistantId: string;
  enabled: boolean;
  roleDefinition: string;
  agentDefinition: string;
  skillIds: readonly string[];
  toolIds: readonly string[];
  mcpServerIds: readonly string[];
  modelByPurpose: Readonly<Partial<Record<TeachingPurpose, TeachingModelSelection>>>;
}

export interface TeachingTeamMember {
  memberId: string;
  assistantId: string;
}

export interface TeachingRoleSource {
  roleSlotId: string;
  memberId: string;
  purposes: readonly TeachingPurpose[];
  skills: readonly TeachingSkillPin[];
  toolIds: readonly string[];
}

export interface TeachingSessionRoute {
  sessionIndex: number;
  roleSlotId: string;
}

export interface TeachingKnowledgeGrant {
  serverId: 'ima-knowledge';
  knowledgeBaseIds: readonly string[];
  allowedTools: readonly string[];
}

/** Compile-time approval ceilings. Live permission checks remain mandatory. */
export interface TeachingApprovalPolicy {
  version: string;
  models: readonly TeachingModelPair[];
  toolIds: readonly string[];
  mcpServerIds: readonly string[];
  imaKnowledgeBaseIds: readonly string[];
}

export interface TeachingBundleSource {
  templateVersionId: string;
  template: ProjectTemplateSpec;
  scheduleProfileId: string;
  teamVersion: {
    teamVersionId: string;
    teamId: string;
    leaderAssistantId: string;
    members: readonly TeachingTeamMember[];
  };
  roles: readonly TeachingRoleSource[];
  sessionRoutes: readonly TeachingSessionRoute[];
  assistants: readonly TeachingAssistantSource[];
  skillArtifacts: readonly ReviewedTeachingSkill[];
  tools: readonly TeachingToolArtifact[];
  knowledgeGrant: TeachingKnowledgeGrant | null;
  approval: TeachingApprovalPolicy;
}

export interface CompiledTeachingRole {
  roleSlotId: string;
  memberId: string;
  assistantId: string;
  assistantConfigDigest: string;
  instructions: { roleDefinition: string; agentDefinition: string };
  modelByPurpose: Readonly<Partial<Record<TeachingPurpose, TeachingModelSelection>>>;
  skills: readonly TeachingSkillPin[];
  tools: readonly TeachingToolArtifact[];
}

export interface TeachingBundlePayload {
  schemaVersion: typeof TEACHING_BUNDLE_SCHEMA_VERSION;
  compilerVersion: typeof TEACHING_BUNDLE_COMPILER_VERSION;
  templateVersionId: string;
  template: ProjectTemplateSpec;
  templateDigest: string;
  scheduleProfileId: string;
  teamVersion: TeachingBundleSource['teamVersion'];
  roles: readonly CompiledTeachingRole[];
  sessionRoutes: readonly TeachingSessionRoute[];
  knowledgeGrant: TeachingKnowledgeGrant | null;
  approvalPolicyVersion: string;
}

export interface CompiledTeachingBundle {
  payload: TeachingBundlePayload;
  canonicalPayload: string;
  digest: string;
}

export class TeachingBundleCompilationError extends Error {
  readonly code = 'TEACHING_BUNDLE_INVALID';

  constructor(readonly issue: string, readonly path: string) {
    super(`${issue}: ${path}`);
    this.name = 'TeachingBundleCompilationError';
  }
}
