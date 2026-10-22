/** Server-resolved frozen lesson scope; the client never assembles proof refs. */
export interface LearningEvidenceScope {
  projectId: string;
  planId: string;
  planRevision: number;
  learningSessionId: string;
  objectiveIds: readonly string[];
}
export interface LearningEvidenceProof {
  activityId?: string;
  quality?: LessonQualityStatus;
  kind: 'session_response' | 'experiment_observation' | 'submitted_artifact' | 'approved_artifact';
  ref: string;
  scope: LearningEvidenceScope;
  objectiveId: string;
  sourceKind: 'task_submission' | 'experiment_observation' | 'reflection';
  artifactId?: string;
  artifactVersionId?: string;
  parameterDigest?: string;
  reviewId?: string;
  mentorId?: string;
}
export interface LessonEvidenceProofs {
  submissions: LearningEvidenceProof[];
  observations: LearningEvidenceProof[];
  approvedArtifacts: LearningEvidenceProof[];
  reflections: LearningEvidenceProof[];
}
export interface LessonEvidenceView extends LessonEvidenceProofs {
  qualityCriteria?: readonly { id: string; description: string }[];
  scope: LearningEvidenceScope;
  sessionType: string;
  allowedActions: string[];
}

export interface LessonQualityStatus {
  status: 'pending' | 'accepted' | 'needs_revision' | 'stale';
  subjectDigest: string;
  feedback: readonly { criterionId: string; meets: boolean; feedback: string }[];
}

export interface LessonQualityDecision {
  planRevision: number;
  evidenceRef: string;
  subjectDigest: string;
  criteria: readonly { criterionId: string; meets: boolean; feedback: string }[];
}

export interface LessonQualityQueueItem {
  planId: string;
  learningSessionId: string;
  planRevision: number;
  projectId: string;
  lessonTitle: string;
  proof: LearningEvidenceProof;
  criteria: readonly { id: string; description: string }[];
  content: string;
}
export interface LearningTextSubmission {
  activityId?: string;
  planRevision: number;
  content: string;
  evidenceRefs?: readonly string[];
  objectiveId?: string;
  title?: string;
  requestReview?: boolean;
}
/** Existing works projection, restricted to fields used in the lesson workspace. */
export interface LearningSubmissionArtifactView {
  id: string;
  projectId: string | null;
  title: string;
  status: 'draft' | 'submitted' | 'in_review' | 'published' | 'changes_requested' | 'archived';
  reviewStatus: 'requested' | 'in_review' | 'approved' | 'changes_requested' | 'rejected' | 'none';
  latestVersion: { id: string; inlineText: string | null } | null;
}
export interface LearningSubmissionResponse {
  proof: LearningEvidenceProof;
  artifact: LearningSubmissionArtifactView;
  assessmentStatus: 'assessment_required';
  masteryUpdated: false;
  replayed: boolean;
}
