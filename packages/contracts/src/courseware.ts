/** Authored content, distinct from student work and runtime action authority. */
export interface CoursewareContent {
  title: string;
  steps: readonly {
    caption: string;
    nodes?: readonly { id: string; label: string }[];
    edges?: readonly { from: string; to: string }[];
    tex?: string;
  }[];
}

export interface CoursewareSource {
  knowledgeBaseId: string;
  documentRefHash: string;
  title: string;
}

export interface LessonTeachingSpec {
  version: 'zero-base.v1';
  concepts: readonly { objectiveId: string; introduction: string }[];
  sourceRequired: true;
  courseware: 'reviewed-with-project-generation.v1';
}

export type CoursewareUse = 'explain' | 'demonstrate' | 'remediate' | 'review';
export type CoursewareStatus = 'candidate' | 'published' | 'withdrawn';
export type CoursewareFeedbackKind = 'science' | 'match' | 'understanding' | 'rendering' | 'suggestion';
export interface CoursewareGeneration {
  policyVersion: 'courseware.v1';
  rendererVersion: 'board.v1';
  modelProviderId: string | null;
  modelId: string | null;
  skillDigests: readonly { canonicalId: string; version: string; packageDigest: string }[];
}

export interface CoursewareVersion {
  assetId: string;
  versionId: string;
  parentVersionId: string | null;
  revision: number;
  status: CoursewareStatus;
  contentHash: string;
  curriculumHash: string;
  generation: CoursewareGeneration;
  feedbackCounts?: Partial<Record<CoursewareFeedbackKind, number>>;
  content: CoursewareContent;
  objectiveRefs: readonly string[];
  use: CoursewareUse;
  sources: readonly CoursewareSource[];
  changeSummary: string;
  review: { scientific: boolean; teaching: boolean; rendering: boolean; privacy: boolean; rights: boolean; note: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoursewareInstance {
  id: string;
  projectId: string;
  planId: string;
  planRevision: number;
  learningSessionId: string;
  activityId: string;
  objectiveRefs: readonly string[];
  content: CoursewareContent;
  contentHash: string;
  curriculumHash: string;
  generation: CoursewareGeneration;
  candidateVersionId: string | null;
  feedback?: readonly CoursewareFeedbackKind[];
  sources: readonly CoursewareSource[];
  assetVersionId: string | null;
  parentVersionId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  position: number;
}

export interface TutorCoursewareView {
  enabled: boolean;
  planId: string;
  planRevision: number;
  learningSessionId: string;
  activityId: string | null;
  teaching: LessonTeachingSpec;
  instances: readonly CoursewareInstance[];
  canContinue: boolean;
  blockedReason: string | null;
}
