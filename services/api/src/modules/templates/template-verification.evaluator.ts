import type {
  ObjectiveMasteryEvidence,
  VerificationCheck,
  VerificationEvidence,
  VerificationReport,
} from './templates.types';

/**
 * 确定性模板验证评测器（纯函数）。
 *
 * 晋升 `published` 的门槛（与设计文档 7.4 / M2 验收一致）：
 * 1. **project_completed**：至少一个使用该模板版本的正式项目已完成；
 * 2. **theory_mastered**：该批项目关联学习计划中的全部理论类目标已掌握；
 * 3. **practice_mastered**：全部实践类目标已掌握；
 * 4. **artifact_accepted**：至少一件作品经班主任复核通过；
 * 5. **mentor_approved**：至少一次项目复核通过。
 *
 * 关键约束：
 * - 只读证据，**不重算掌握度**——`mastered` 来自掌握度引擎；
 * - 纯函数、无时间以外的随机/外部依赖：同输入必然同输出（可重放）；
 * - `evaluatedAt` 由调用方注入，保证测试可固定断言。
 */
export const THEORY_KNOWLEDGE_TYPES: readonly string[] = ['memory', 'concept'];
export const PRACTICE_KNOWLEDGE_TYPES: readonly string[] = ['procedure', 'design'];

export function evaluateTemplateVerification(
  evidence: VerificationEvidence,
  evaluatedAt: Date,
): VerificationReport {
  const checks: VerificationCheck[] = [
    projectCompletedCheck(evidence),
    theoryMasteredCheck(evidence),
    practiceMasteredCheck(evidence),
    artifactAcceptedCheck(evidence),
    mentorApprovedCheck(evidence),
  ];
  return {
    templateVersionId: evidence.templateVersionId,
    passed: checks.every((check) => check.passed),
    checks,
    evidenceRefs: collectEvidenceRefs(evidence),
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

function projectCompletedCheck(evidence: VerificationEvidence): VerificationCheck {
  const count = evidence.completedProjectIds.length;
  return {
    key: 'project_completed',
    label: '项目完成',
    passed: count >= 1,
    detail: `已完成项目 ${count} 个`,
  };
}

function theoryMasteredCheck(evidence: VerificationEvidence): VerificationCheck {
  return masteryCheck('theory_mastered', '理论掌握', evidence.theoryObjectives);
}

function practiceMasteredCheck(evidence: VerificationEvidence): VerificationCheck {
  return masteryCheck('practice_mastered', '实践掌握', evidence.practiceObjectives);
}

function masteryCheck(
  key: 'theory_mastered' | 'practice_mastered',
  label: string,
  objectives: ObjectiveMasteryEvidence[],
): VerificationCheck {
  const total = objectives.length;
  const mastered = objectives.filter((o) => o.mastered).length;
  return {
    key,
    label,
    passed: total >= 1 && mastered === total,
    detail: `已掌握 ${mastered}/${total} 个目标`,
  };
}

function artifactAcceptedCheck(evidence: VerificationEvidence): VerificationCheck {
  const count = evidence.artifactAcceptedRefs.length;
  return {
    key: 'artifact_accepted',
    label: '作品通过',
    passed: count >= 1,
    detail: `通过复核的作品 ${count} 件`,
  };
}

function mentorApprovedCheck(evidence: VerificationEvidence): VerificationCheck {
  const count = evidence.mentorApprovalRefs.length;
  return {
    key: 'mentor_approved',
    label: '班主任复核通过',
    passed: count >= 1,
    detail: `项目复核通过 ${count} 次`,
  };
}

function collectEvidenceRefs(evidence: VerificationEvidence): string[] {
  return [
    ...evidence.completedProjectIds.map((id) => `project:${id}`),
    ...evidence.theoryObjectives.map((o) => `objective:${o.objectiveId}`),
    ...evidence.practiceObjectives.map((o) => `objective:${o.objectiveId}`),
    ...evidence.artifactAcceptedRefs.map((ref) => `artifact:${ref}`),
    ...evidence.mentorApprovalRefs.map((ref) => `mentor-review:${ref}`),
  ];
}
