import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EvidenceRequirement, PblRubric } from '@qitu/contracts';
import { toProjectReviewCandidate, validateProjectReviewCandidate } from './project-review';
import type { MentorReviewRecord } from './works.store';

const rubric: PblRubric = {
  id: 'robot-rubric',
  version: '1',
  title: '机器人作品',
  passingScore: 60,
  criteria: [{
    id: 'function', title: '功能', description: '可运行', evidenceRequirementIds: ['run'],
    levels: { 0: '无', 1: '初步', 2: '基本', 3: '良好', 4: '优秀' }, weight: 1,
  }],
};
const requirements: EvidenceRequirement[] = [{
  id: 'run', objectiveId: 'build', title: '运行记录', description: '演示视频',
  types: ['video'], required: true, visibility: 'teacher', validation: 'teacher_check',
}];
const review = (status: MentorReviewRecord['status']): MentorReviewRecord => ({
  id: 'mentor-review-1', schoolId: null, studentId: 'student-1', mentorUserId: 'teacher-1',
  projectId: 'project-1', artifactId: 'artifact-1', kind: 'artifact', status,
  decision: null, comment: null, idempotencyKey: 'review-1', requestedAt: new Date('2026-01-01'),
  reviewedAt: status === 'approved' ? new Date('2026-01-02') : null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
});

describe('project review contract adapter', () => {
  it('maps Works approved review to teacher accepted candidate', () => {
    const candidate = toProjectReviewCandidate({ review: review('approved'), artifactVersionId: 'artifact-1-v1', rubric, now: new Date('2026-01-03') });
    assert.equal(candidate.status, 'accepted');
    assert.equal(candidate.source, 'teacher');
    assert.equal(candidate.reviewedBy, 'teacher-1');
    assert.equal(candidate.projectId, 'project-1');
  });

  it('rejects AI acceptance and missing required evidence', () => {
    const candidate = {
      ...toProjectReviewCandidate({ review: review('in_review'), artifactVersionId: 'artifact-1-v1', rubric }),
      source: 'ai' as const, status: 'accepted' as const, modelId: 'model-1',
      criteria: [{ criterionId: 'function', level: 3 as const, rationale: 'ok', evidenceRefs: [] }],
    };
    const errors = validateProjectReviewCandidate({ candidate, rubric, evidenceRequirements: requirements, availableEvidenceIds: [] });
    assert.ok(errors.some((error) => error.includes('AI review')));
    assert.ok(errors.some((error) => error.includes('required evidence')));
    assert.ok(errors.some((error) => error.includes('required evidence')));
  });

  it('accepts a teacher candidate only when required evidence is available', () => {
    const candidate = {
      ...toProjectReviewCandidate({ review: review('approved'), artifactVersionId: 'artifact-1-v1', rubric }),
      status: 'accepted' as const,
      criteria: [{ criterionId: 'function', level: 3 as const, rationale: 'runs', evidenceRefs: ['run-video-1'] }],
    };
    const errors = validateProjectReviewCandidate({ candidate, rubric, evidenceRequirements: requirements, availableEvidenceIds: ['run', 'run-video-1'] });
    assert.deepEqual(errors, []);
  });
});
