import type { CurrentUser } from '@qitu/contracts';
import { DirectoryService } from '../directory/directory.service';
import type { ArtifactStatus } from './artifact-state-machine';
import { isArtifactEditable } from './artifact-state-machine';
import type { ArtifactVisibility } from './works.store';

/**
 * 作品对象级授权的**纯判定规则**（产品文档 3.4 五段式检查）。
 *
 * 规则层不查库、无 Nest 依赖；关系由 `WorksDirectory` 先解析后传入。
 * 判定矩阵（学生前后端设计 §5.6）：
 * | 角色 | 可读 | 可写 |
 * |---|---|---|
 * | 学生本人 | 任意状态 | 仅 `draft` / `changes_requested` |
 * | 当前班主任 | 仅已发布 | ✗ |
 * | 已授权家长 | 仅已发布且非 `student_private` | ✗ |
 * | 其他 | ✗ | ✗ |
 *
 * `admin` / `support` 与设计一致 fail closed：个别未成年作品访问需显式授权，
 * 在授权模型落地前默认拒绝，而不是按角色大小放行。
 */

export interface ArtifactRef {
  studentId: string;
  status: ArtifactStatus;
  visibility: ArtifactVisibility;
}

export interface ArtifactRelationship {
  /** 主体是否为作品所属学生本人。 */
  isOwner: boolean;
  /** 主体是否为该学生的当前班主任（active mentor assignment）。 */
  isMentor: boolean;
  /** 主体是否为该学生的当前监护人（active guardian link）。 */
  isGuardian: boolean;
}

export function canReadArtifact(
  actor: CurrentUser,
  artifact: ArtifactRef,
  relationship: ArtifactRelationship,
): boolean {
  switch (actor.role) {
    case 'student':
      return relationship.isOwner;
    case 'teacher':
      return relationship.isMentor && artifact.status === 'published';
    case 'parent':
      return (
        relationship.isGuardian &&
        artifact.status === 'published' &&
        artifact.visibility !== 'student_private'
      );
    case 'admin':
    case 'support':
      return false;
    default:
      return false;
  }
}

export function canWriteArtifact(
  actor: CurrentUser,
  artifact: ArtifactRef,
  relationship: ArtifactRelationship,
): boolean {
  if (actor.role !== 'student') return false;
  if (!relationship.isOwner) return false;
  return isArtifactEditable(artifact.status);
}

/**
 * 关系解析端口。生产实现包一层 `DirectoryService`（关系唯一真源）；
 * 单测注入内存替身，避免在业务规则测试里搭数据库。
 */
export abstract class WorksDirectory {
  abstract isMentorOf(mentorUserId: string, studentId: string): Promise<boolean>;
  abstract isGuardianOf(parentUserId: string, studentId: string): Promise<boolean>;
  /** 班主任当前负责的学生 id 列表（列表接口的分页范围）。 */
  abstract studentsOfMentor(mentorUserId: string): Promise<string[]>;
  /** 家长当前绑定的孩子 id 列表。 */
  abstract childrenOfParent(parentUserId: string): Promise<string[]>;
  /** 学生当前 active 班主任；没有时为 null（用于复核记录联动）。 */
  abstract mentorOfStudent(studentId: string): Promise<string | null>;
  /** 学生的学校 id，可空。 */
  abstract schoolOfStudent(studentId: string): Promise<string | null>;
}

/** 生产适配器：复用 DirectoryService 的 active 关系，不另建名单。 */
export class DirectoryWorksDirectory extends WorksDirectory {
  constructor(private readonly directory: DirectoryService) {
    super();
  }

  async isMentorOf(mentorUserId: string, studentId: string): Promise<boolean> {
    const mentor = await this.directory.mentorOfStudent(studentId);
    return mentor !== null && mentor.userId === mentorUserId;
  }

  async isGuardianOf(parentUserId: string, studentId: string): Promise<boolean> {
    const children = await this.directory.childrenOfParent(parentUserId);
    return children.some((child) => child.userId === studentId);
  }

  async studentsOfMentor(mentorUserId: string): Promise<string[]> {
    const students = await this.directory.studentsOfMentor(mentorUserId);
    return students.map((student) => student.userId);
  }

  async childrenOfParent(parentUserId: string): Promise<string[]> {
    const children = await this.directory.childrenOfParent(parentUserId);
    return children.map((child) => child.userId);
  }

  async mentorOfStudent(studentId: string): Promise<string | null> {
    const mentor = await this.directory.mentorOfStudent(studentId);
    return mentor?.userId ?? null;
  }

  async schoolOfStudent(_studentId: string): Promise<string | null> {
    // 当前 DirectoryService 未暴露学生学校投影；学校字段可空，且不参与授权，
    // 这里诚实地返回 null，而不是编造。接入学校解析时在此补齐。
    return null;
  }
}
