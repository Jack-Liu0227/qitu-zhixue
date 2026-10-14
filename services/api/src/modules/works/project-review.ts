import type {
  EvidenceRequirement,
  PblRubric,
  ProjectReviewCandidate,
  ProjectReviewCandidateStatus,
  RubricLevel,
} from '@qitu/contracts';
import type { MentorReviewRecord } from './works.store';

/** Adapter from the existing Works review record to the PBL review contract. */
export function toProjectReviewCandidate(input: {
  review: MentorReviewRecord;
  artifactVersionId: string;
  rubric: PblRubric;
  now?: Date;
}): ProjectReviewCandidate {
  const { review, artifactVersionId, rubric } = input;
  const timestamp = (input.now ?? new Date()).toISOString();
  return {
    id: `review-candidate:${review.id}:${artifactVersionId}`,
    projectId: review.projectId ?? '',
    artifactVersionId,
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    status: reviewStatusToCandidateStatus(review.status),
    score: null,
    criteria: [],
    missingEvidenceIds: [],
    source: 'teacher',
    modelId: null,
    reviewedBy: review.reviewedAt === null ? null : review.mentorUserId,
    createdAt: review.createdAt.toISOString(),
    updatedAt: timestamp,
  };
}

function reviewStatusToCandidateStatus(status: MentorReviewRecord['status']): ProjectReviewCandidateStatus {
  switch (status) {
    case 'approved':
      return 'accepted';
    case 'changes_requested':
      return 'returned';
    case 'rejected':
      return 'rejected';
    case 'requested':
    case 'in_review':
      return 'pending';
  }
}

export interface ProjectReviewValidationInput {
  candidate: ProjectReviewCandidate;
  rubric: PblRubric;
  evidenceRequirements: readonly EvidenceRequirement[];
  availableEvidenceIds: readonly string[];
}

/**
 * Validate a candidate at the review boundary. This intentionally returns
 * errors instead of throwing so callers can persist a `needs_evidence`
 * candidate or present actionable feedback to a teacher.
 */
export function validateProjectReviewCandidate(input: ProjectReviewValidationInput): string[] {
  const { candidate, rubric, evidenceRequirements, availableEvidenceIds } = input;
  const errors: string[] = [];
  const criterionIds = new Set(rubric.criteria.map((criterion) => criterion.id));
  const criterionById = new Map(rubric.criteria.map((criterion) => [criterion.id, criterion]));
  const requirementById = new Map(evidenceRequirements.map((requirement) => [requirement.id, requirement]));
  const available = new Set(availableEvidenceIds);

  if (candidate.rubricId !== rubric.id || candidate.rubricVersion !== rubric.version) {
    errors.push('candidate rubric does not match the selected rubric version');
  }
  if (candidate.source === 'ai' && candidate.status === 'accepted') {
    errors.push('AI review cannot directly produce an accepted candidate');
  }
  if (candidate.source === 'ai' && candidate.modelId === null) {
    errors.push('AI candidate must identify its model');
  }
  if (candidate.source === 'teacher' && candidate.status === 'accepted' && candidate.reviewedBy === null) {
    errors.push('accepted teacher candidate must identify the reviewer');
  }
  if (candidate.score !== null && (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 100)) {
    errors.push('score must be between 0 and 100');
  }

  const seenCriteria = new Set<string>();
  for (const result of candidate.criteria) {
    if (!criterionIds.has(result.criterionId)) errors.push(`unknown criterion: ${result.criterionId}`);
    if (seenCriteria.has(result.criterionId)) errors.push(`duplicate criterion: ${result.criterionId}`);
    seenCriteria.add(result.criterionId);
    if (!Number.isInteger(result.level) || result.level < 0 || result.level > 4) {
      errors.push(`invalid level for criterion: ${result.criterionId}`);
    }
    if (result.evidenceRefs.some((ref) => !available.has(ref))) {
      errors.push(`criterion ${result.criterionId} references unavailable evidence`);
    }
  }

  const missing = new Set(candidate.missingEvidenceIds);
  for (const requirement of evidenceRequirements) {
    if (!requirement.required) continue;
    const satisfied = available.has(requirement.id) || candidate.criteria.some((result) => {
      const criterion = criterionById.get(result.criterionId);
      return criterion?.evidenceRequirementIds.includes(requirement.id) === true &&
        result.evidenceRefs.some((ref) => available.has(ref));
    });
    if (!satisfied && !missing.has(requirement.id)) {
      errors.push(`required evidence is neither available nor declared missing: ${requirement.id}`);
    }
  }
  for (const id of candidate.missingEvidenceIds) {
    if (!requirementById.has(id)) errors.push(`unknown missing evidence requirement: ${id}`);
  }
  if (candidate.status === 'accepted' && candidate.missingEvidenceIds.length > 0) {
    errors.push('accepted candidate cannot have missing evidence');
  }
  return errors;
}

export function isProjectReviewReady(input: ProjectReviewValidationInput): boolean {
  return validateProjectReviewCandidate(input).length === 0 &&
    input.candidate.status === 'ready_for_teacher';
}

export function isRubricLevel(value: number): value is RubricLevel {
  return Number.isInteger(value) && value >= 0 && value <= 4;
}
