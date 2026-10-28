import type { LearningEvidenceScope } from '@qitu/contracts';
export type { LearningEvidenceScope, LearningEvidenceProof, LessonEvidenceProofs } from '@qitu/contracts';

export interface LearningSubmissionReceipt {
  activityId?: string;
  schema: 'qitu.learning-submission.v1';
  kind: 'session_response' | 'submitted_artifact';
  scope: LearningEvidenceScope;
  artifactId: string;
  artifactVersionId: string;
  contentDigest: string;
  requestReview?: true;
  evidenceRefs: readonly string[];
}
