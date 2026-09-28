import { Injectable, Inject } from '@nestjs/common';
import type {
  ChildRef,
  GrowthProjectOption,
  ParentGrowthEntry,
  ParentGrowthPageData,
  ParentGrowthSummary,
  ProjectStage,
  StudentGrowthEntry,
  StudentGrowthEntryType,
  StudentGrowthIcon,
  StudentGrowthQuery,
  StudentGrowthSummary,
  StudentGrowthTimeline,
} from '@qitu/contracts';
import type { DirectoryService } from '../directory/directory.service';
import { normaliseEvidenceIds, observationStateFor } from './growth.evidence';

/**
 * 成长轨迹服务端。
 *
 * 两条硬规则（AGENTS.md + growth-spec.md §8）：
 *  1. 成长档案**没有客户端写路径**。这个服务只对外暴露读接口；记录由服务端
 *     自己产生（`recordStageCompletion` / `recordArtifactPublished` / …）。
 *  2. 学生端与家长端读的是**同一个**存储，只是投影字段不同。所以「和家长端
 *     同步」不是靠两边各自刷新，而是构造上就只有一份真相。
 *
 * 存储是进程内的：这符合当前「模块化单体 + 无数据库」的形态。换数据库时只需
 * 替换下面三个私有 Map，控制器与投影逻辑不用动。
 */

const PROJECT_TITLES: Record<string, string> = {
  'project-demo-001': '校园植物观察手册',
  'project-demo-002': '天气数据小助手',
};

/** 终态阶段集合：只有走到这里才算「完成一个项目」。 */
const TERMINAL_STAGES = new Set<ProjectStage>(['published', 'completed']);

const ICON_BY_TYPE: Record<StudentGrowthEntryType, StudentGrowthIcon> = {
  project_stage_completed: 'stage',
  artifact_published: 'artifact',
  reflection_created: 'reflection',
  objective_mastered: 'objective',
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface GrowthRecordInput {
  studentId: string;
  type: StudentGrowthEntryType;
  occurredAt: string;
  title: string;
  summaryStudent: string;
  summaryParent: string;
  projectId?: string | null;
  stage?: ProjectStage | null;
  artifactRef?: string | null;
  objectiveTitles?: string[];
  encouragement?: string | null;
  /**
   * 服务端证据引用（`sourceKind:opaqueId`）。调用方传入的值会经过白名单
   * 归一化；非法 / 未知来源被静默丢弃，绝不影响记录本身的写入。
   */
  evidenceIds?: string[];
}

@Injectable()
export class GrowthService {
  /** 唯一的成长记录真相。 */
  private readonly records = new Map<string, StudentGrowthEntry[]>();

  /** 家长投影用的措辞与学生投影是两条独立文案，绝不互相兜底。 */
  private readonly parentWording = new Map<string, string>();

  constructor(
    @Inject('DirectoryService') private readonly directory: DirectoryService,
  ) {
    this.seedDemoData();
  }

  /* --------------------------- 读：学生投影 --------------------------- */

  getProjects(studentId: string): GrowthProjectOption[] {
    const seen = new Map<string, string>();
    for (const entry of this.entries(studentId)) {
      if (entry.projectId === null) continue;
      if (seen.has(entry.projectId)) continue;
      seen.set(entry.projectId, entry.projectTitle ?? entry.projectId);
    }
    return [...seen.entries()].map(([id, title]) => ({ id, title }));
  }

  getSummary(studentId: string): StudentGrowthSummary {
    const all = this.entries(studentId);
    return {
      streakDays: this.computeStreak(all),
      projectsCompleted: this.countCompletedProjects(all),
      objectivesMastered: new Set(all.flatMap((entry) => entry.objectiveTitles)).size,
      artifactsPublished: all.filter((entry) => entry.type === 'artifact_published').length,
    };
  }

  /**
   * 时间线分页。游标是「上一页最后一条的 id」，服务端在同一排序下反查下标；
   * 排序是 `occurredAt` 降序、同时间按 id 降序，保证稳定不重复不跳过。
   */
  getTimeline(studentId: string, query: StudentGrowthQuery): StudentGrowthTimeline {
    const limit = this.normaliseLimit(query.limit);
    const filtered = this.sorted(this.entries(studentId)).filter((entry) => {
      if (query.type !== 'all' && entry.type !== query.type) return false;
      if (query.projectId !== null && entry.projectId !== query.projectId) return false;
      if (query.from !== null && entry.occurredAt < query.from) return false;
      if (query.to !== null && entry.occurredAt > query.to) return false;
      return true;
    });

    let start = 0;
    if (query.cursor !== null) {
      const index = filtered.findIndex((entry) => entry.id === query.cursor);
      // 未知游标按「从头开始」处理，而不是报错：旧链接仍然可用。
      start = index === -1 ? 0 : index + 1;
    }

    const page = filtered.slice(start, start + limit);
    const hasNext = start + limit < filtered.length;
    return {
      items: page,
      nextCursor: hasNext && page.length > 0 ? page[page.length - 1]!.id : null,
      hasNext,
    };
  }

  /* --------------------------- 读：家长投影 --------------------------- */

  /** 只返回**这个家长自己**的孩子。越权在服务端挡住，不靠前端隐藏。 */
  async getChildren(parentId: string): Promise<ChildRef[]> {
    const children = await this.directory.childrenOfParent(parentId);
    return children.map((child) => ({
      childId: child.userId,
      displayName: child.displayName,
      activeProjectCount: this.getProjects(child.userId).length,
    }));
  }

  /** 家长是否能看到这个孩子。控制器必须先问这个方法。 */
  async canParentReadChild(parentId: string, childId: string): Promise<boolean> {
    const children = await this.directory.childrenOfParent(parentId);
    return children.some((c) => c.userId === childId);
  }

  async getParentPage(childId: string, query: StudentGrowthQuery): Promise<ParentGrowthPageData> {
    const studentSummary = this.getSummary(childId);
    const all = this.entries(childId);
    const timeline = this.getTimeline(childId, query);

    // 显示名从目录取，而不是本地硬编码。
    //
    // 之前这里是一张写死的 { student-demo: '小宇', student-demo-2: '小禾' } 表，
    // 于是同一个孩子在家长端叫「小宇」、在教师名册和管理后台叫「演示学生」。
    // 目录是身份的唯一真相，所以这里直接问它——多出一个 await 换来全站一致。
    const child = await this.directory.findUser(childId);
    const childDisplayName = child?.displayName ?? '孩子';

    const summary: ParentGrowthSummary = {
      childId,
      childDisplayName,
      streakDays: studentSummary.streakDays,
      projectsCompleted: studentSummary.projectsCompleted,
      objectivesMastered: studentSummary.objectivesMastered,
      artifactsPublished: studentSummary.artifactsPublished,
      lastActivityAt: all.length === 0 ? null : this.sorted(all)[0]!.occurredAt,
    };

    return {
      summary,
      timeline: {
        items: timeline.items.map((entry) => this.toParentEntry(entry)),
        nextCursor: timeline.nextCursor,
        hasNext: timeline.hasNext,
      },
    };
  }

  /* --------------------------- 写：仅服务端 --------------------------- */

  /**
   * 服务端内部写入。控制器**不**暴露这个能力——成长档案不能由客户端写。
   */
  record(input: GrowthRecordInput): StudentGrowthEntry {
    const projectTitle =
      input.projectId === undefined || input.projectId === null
        ? null
        : (PROJECT_TITLES[input.projectId] ?? input.projectId);

    // 证据引用只走服务端白名单；观察状态由证据有无推导，客户端无法写入。
    const evidenceIds = normaliseEvidenceIds(input.evidenceIds);

    const entry: StudentGrowthEntry = {
      id: `growth-${input.studentId}-${this.entries(input.studentId).length + 1}`,
      type: input.type,
      occurredAt: input.occurredAt,
      title: input.title,
      summaryStudent: input.summaryStudent,
      projectId: input.projectId ?? null,
      projectTitle,
      stage: input.stage ?? null,
      artifactRef: input.artifactRef ?? null,
      objectiveTitles: input.objectiveTitles ?? [],
      icon: ICON_BY_TYPE[input.type],
      encouragement: input.encouragement ?? null,
      evidenceIds,
      observationState: observationStateFor(evidenceIds),
    };

    this.entries(input.studentId).push(entry);
    this.parentWording.set(entry.id, input.summaryParent);
    return entry;
  }

  /* ------------------------------ 内部 ------------------------------ */

  private entries(studentId: string): StudentGrowthEntry[] {
    let list = this.records.get(studentId);
    if (list === undefined) {
      list = [];
      this.records.set(studentId, list);
    }
    return list;
  }

  private sorted(entries: StudentGrowthEntry[]): StudentGrowthEntry[] {
    return [...entries].sort((a, b) => {
      if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
  }

  private toParentEntry(entry: StudentGrowthEntry): ParentGrowthEntry {
    return {
      id: entry.id,
      type: entry.type,
      occurredAt: entry.occurredAt,
      title: entry.title,
      // 家长文案独立取用；缺失时用学生文案兜底也绝不带内部风险标签。
      summaryParent: this.parentWording.get(entry.id) ?? entry.summaryStudent,
      projectTitle: entry.projectTitle,
      stage: entry.stage,
      artifactRef: entry.artifactRef,
    };
  }

  private normaliseLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(limit), MAX_LIMIT);
  }

  private countCompletedProjects(entries: StudentGrowthEntry[]): number {
    const completed = new Set<string>();
    for (const entry of entries) {
      if (entry.projectId === null) continue;
      if (entry.stage === null) continue;
      if (!TERMINAL_STAGES.has(entry.stage)) continue;
      completed.add(entry.projectId);
    }
    return completed.size;
  }

  /** 连续天数：从最近一天往回数，必须是连续的自然日。 */
  private computeStreak(entries: StudentGrowthEntry[]): number {
    const days = new Set(entries.map((entry) => entry.occurredAt.slice(0, 10)));
    if (days.size === 0) return 0;

    let streak = 0;
    const cursor = new Date(`${[...days].sort().pop()!}T00:00:00.000Z`);
    for (;;) {
      const key = cursor.toISOString().slice(0, 10);
      if (!days.has(key)) break;
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return streak;
  }

  /* ------------------------------ 演示数据 ------------------------------ */

  /**
   * 演示学生的既有成长档案。
   *
   * 时间是**相对当前时间**生成的，所以「连续天数」在任何一天打开都不是 0，
   * 也不会随着代码老化而变成几个月前。
   */
  private seedDemoData(): void {
    const daysAgo = (days: number, hour = 16): string => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - days);
      date.setUTCHours(hour, 0, 0, 0);
      return date.toISOString();
    };

    this.record({
      studentId: 'student-demo',
      type: 'reflection_created',
      occurredAt: daysAgo(1, 17),
      title: '写下第一次观察反思',
      summaryStudent: '你把「叶子为什么朝光长」这个问题写下来了，还加了自己的猜想。',
      summaryParent: '孩子主动记录了一次观察反思，提出了自己的猜想。',
      projectId: 'project-demo-001',
      stage: 'reflection',
      encouragement: '会发现好问题，比会背答案更重要。',
      evidenceIds: ['reflection:reflection-demo-001'],
    });

    this.record({
      studentId: 'student-demo',
      type: 'artifact_published',
      occurredAt: daysAgo(2, 15),
      title: '发布作品《校园植物观察手册（第 1 版）》',
      summaryStudent: '你的观察手册第一次发布，里面有 6 种植物的记录。',
      summaryParent: '孩子发布了一件作品，包含 6 种植物的观察记录。',
      projectId: 'project-demo-001',
      stage: 'published',
      artifactRef: 'artifact-demo-001',
      evidenceIds: ['artifact:artifact-demo-001'],
    });

    this.record({
      studentId: 'student-demo',
      type: 'objective_mastered',
      occurredAt: daysAgo(3, 16),
      title: '掌握「光合作用的条件」',
      summaryStudent: '你用自己的话说明了光合作用需要光和水，并举出了反例。',
      summaryParent: '孩子掌握了一个学习目标，并能举例说明。',
      projectId: 'project-demo-001',
      stage: 'theory_check',
      objectiveTitles: ['光合作用的条件'],
      evidenceIds: ['theory_check:theory-demo-001', 'student_answer:answer-demo-001'],
    });

    this.record({
      studentId: 'student-demo',
      type: 'project_stage_completed',
      occurredAt: daysAgo(4, 14),
      title: '完成「理论闯关」阶段',
      summaryStudent: '理论部分全部通过，你准备好动手做观察手册了。',
      summaryParent: '孩子完成了项目的理论阶段，进入实践准备。',
      projectId: 'project-demo-001',
      stage: 'practice_ready',
      evidenceIds: ['theory_check:theory-demo-002'],
    });

    this.record({
      studentId: 'student-demo',
      type: 'objective_mastered',
      occurredAt: daysAgo(5, 16),
      title: '掌握「观察记录的要素」',
      summaryStudent: '你记住了观察记录要写时间、地点和变化。',
      summaryParent: '孩子掌握了一个学习目标。',
      projectId: 'project-demo-001',
      stage: 'theory_learning',
      objectiveTitles: ['观察记录的要素'],
      evidenceIds: ['student_answer:answer-demo-002'],
    });

    this.record({
      studentId: 'student-demo',
      type: 'project_stage_completed',
      occurredAt: daysAgo(6, 11),
      title: '确认项目方向：校园植物观察手册',
      summaryStudent: '你决定做一个校园植物观察手册，方向是你自己选的。',
      summaryParent: '孩子确认了自己的项目方向。',
      projectId: 'project-demo-001',
      stage: 'intent_confirmed',
    });
  }
}
