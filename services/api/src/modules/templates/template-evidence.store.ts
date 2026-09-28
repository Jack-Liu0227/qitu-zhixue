import type { VerificationEvidence } from './templates.types';

/**
 * 验证证据来源边界。
 *
 * 服务层与评测器只依赖本抽象。生产实现只**读取**领域表，不写入、不重算掌握度：
 * `TheoryMastered` 由掌握度引擎唯一裁决（本模块只读 `mastery_records.status`）。
 */
export abstract class TemplateEvidenceSource {
  abstract collect(templateVersionId: string): Promise<VerificationEvidence>;
}

/**
 * 视角目录：解析治理主体所属学校，用于对象级作用域判定。
 *
 * 不扩展 `DirectoryService`（避免改动共享契约），只在模板模块内部查 `users.school_id`。
 */
export abstract class TemplateViewerDirectory {
  abstract findSchoolId(userId: string): Promise<string | null>;
}

export function emptyEvidence(templateVersionId: string): VerificationEvidence {
  return {
    templateVersionId,
    completedProjectIds: [],
    theoryObjectives: [],
    practiceObjectives: [],
    artifactAcceptedRefs: [],
    mentorApprovalRefs: [],
  };
}

function cloneEvidence(evidence: VerificationEvidence): VerificationEvidence {
  return {
    templateVersionId: evidence.templateVersionId,
    completedProjectIds: [...evidence.completedProjectIds],
    theoryObjectives: evidence.theoryObjectives.map((o) => ({ ...o })),
    practiceObjectives: evidence.practiceObjectives.map((o) => ({ ...o })),
    artifactAcceptedRefs: [...evidence.artifactAcceptedRefs],
    mentorApprovalRefs: [...evidence.mentorApprovalRefs],
  };
}

/** 内存实现：仅用于 `demo` / `test`。测试可直接 `seed` 证据。 */
export class InMemoryTemplateEvidenceSource extends TemplateEvidenceSource {
  private readonly byVersion = new Map<string, VerificationEvidence>();

  seed(evidence: VerificationEvidence): void {
    this.byVersion.set(evidence.templateVersionId, cloneEvidence(evidence));
  }

  async collect(templateVersionId: string): Promise<VerificationEvidence> {
    const found = this.byVersion.get(templateVersionId);
    return found === undefined ? emptyEvidence(templateVersionId) : cloneEvidence(found);
  }

  reset(): void {
    this.byVersion.clear();
  }
}

/** 内存视角目录：测试注入 `userId → schoolId` 映射。 */
export class InMemoryTemplateViewerDirectory extends TemplateViewerDirectory {
  private readonly schools = new Map<string, string | null>();

  setSchoolId(userId: string, schoolId: string | null): void {
    this.schools.set(userId, schoolId);
  }

  async findSchoolId(userId: string): Promise<string | null> {
    return this.schools.get(userId) ?? null;
  }

  reset(): void {
    this.schools.clear();
  }
}
