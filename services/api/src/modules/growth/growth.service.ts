import type { CurrentUser } from '@qitu/contracts';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
import type { DataMode } from '../../database';
import { DATA_MODE_TOKEN } from '../../database';
import { observationStateFor } from './growth.evidence';
import {
  buildGrowthStoredRecord,
  type GrowthRecordInput,
  type GrowthStoredRecord,
} from './growth.record';
import {
  GROWTH_RECORD_STORE,
  GrowthRecordStore,
  InMemoryGrowthRecordStore,
} from './growth.persistence';

export type { GrowthRecordInput } from './growth.record';

/**
 * 成长轨迹服务端。
 *
 * 两条硬规则（AGENTS.md + growth-spec.md §8）：
 *  1. 成长档案**没有客户端写路径**。这个服务只对外暴露读接口；记录由服务端
 *     自己产生（`record`），HTTP 层永不提供写接口。
 *  2. 学生端与家长端读的是**同一个**存储，只是投影字段不同。所以「和家长端
 *     同步」不是靠两边各自刷新，而是构造上就只有一份真相。
 *
 * 持久化（迁移 0008 `growth_records`，ADR 0006）：
 *  - live（有 `DATABASE_URL`）：`PostgresGrowthRecordStore` 是真相，启动时
 *    `onModuleInit` 把库中记录水合成**只读内存快照**，使既有同步读投影无需改成
 *    async；写记录（`record`）先落库（`idempotency_key` 唯一、只追加），成功后
 *    同步更新快照。
 *  - demo / test：`InMemoryGrowthRecordStore` + 确定性演示 fixture，仅非 live。
 *
 * 这样控制器与家长导出服务的读契约（同步返回）保持不变；代价与收敛方案见
 * `growth-persistence.md`（多实例快照滞后、`encouragement` 未落表等）。
 */

/** 演示项目标题。正式环境下标题由读模型从 `projects` 表 join 补齐。 */
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

@Injectable()
export class GrowthService {
  private readonly logger = new Logger(GrowthService.name);

  /** 只读内存快照：live 下由启动水合 + 服务端写入填充；非 live 由 fixture 填充。 */
  private readonly records = new Map<string, GrowthStoredRecord[]>();

  constructor(
    @Inject('DirectoryService') private readonly directory: DirectoryService,
    @Inject(GROWTH_RECORD_STORE)
    private readonly store: GrowthRecordStore = new InMemoryGrowthRecordStore(),
    @Optional()
    @Inject(DATA_MODE_TOKEN)
    private readonly dataMode: DataMode = 'test',
    @Optional() private readonly mastery?: MasteryDomainService,
  ) {
    // 演示 / 测试 fixture 只在**非持久化**存储上灌入；live 永远不会写演示数据。
    if (!this.store.persistent) {
      const fixtures = this.buildDemoRecords();
      this.store.seed(fixtures);
      for (const record of fixtures) this.cacheRecord(record);
    }
  }

  /**
   * live 启动时从规范表水合只读快照。
   *
   * 水合失败会向上抛，让进程 fail-fast（而不是带着空快照对外服务、看起来像
   * 「学生没有成长记录」）。
   */
  async onModuleInit(): Promise<void> {
    if (!this.store.persistent) return;
    const rows = await this.store.listAll();
    for (const record of rows) this.cacheRecord(record);
    this.logger.log(
      `GrowthService：已从 growth_records 水合 ${rows.length} 条记录（只读快照）。`,
    );
  }

  async getMasteryProfile(actor: CurrentUser, studentId: string) {
    if (!this.mastery) throw new Error('MASTERY_PORT_NOT_CONFIGURED');
    const snapshot = await this.mastery.forActor(actor).snapshot({ studentId, validAt: new Date().toISOString(), knownAt: null });
    return { studentId, growth: this.getSummary(studentId), mastery: snapshot };
  }

  /* --------------------------- 读：学生投影 --------------------------- */

  getProjects(studentId: string): GrowthProjectOption[] {
    const seen = new Map<string, string>();
    for (const record of this.recordsFor(studentId)) {
      if (record.projectId === null) continue;
      if (seen.has(record.projectId)) continue;
      seen.set(record.projectId, record.projectTitle ?? record.projectId);
    }
    return [...seen.entries()].map(([id, title]) => ({ id, title }));
  }

  getSummary(studentId: string): StudentGrowthSummary {
    const all = this.recordsFor(studentId);
    return {
      streakDays: this.computeStreak(all),
      projectsCompleted: this.countCompletedProjects(all),
      objectivesMastered: new Set(all.flatMap((record) => record.objectiveTitles)).size,
      artifactsPublished: all.filter((record) => record.type === 'artifact_published').length,
    };
  }

  /**
   * 时间线分页。游标是「上一页最后一条的 id」，服务端在同一排序下反查下标；
   * 排序是 `occurredAt` 降序、同时间按 id 降序，保证稳定不重复不跳过。
   */
  getTimeline(studentId: string, query: StudentGrowthQuery): StudentGrowthTimeline {
    const page = this.queryRecords(studentId, query);
    return {
      items: page.records.map((record) => this.toStudentEntry(record)),
      nextCursor: page.nextCursor,
      hasNext: page.hasNext,
    };
  }

  /**
   * 分页查询规范记录。学生投影与家长投影都从这里取同一页，保证两端同步。
   *
   * 游标是「上一页最后一条的 id」，服务端在同一排序下反查下标；排序是
   * `occurredAt` 降序、同时间按 id 降序，保证稳定不重复不跳过。
   */
  private queryRecords(
    studentId: string,
    query: StudentGrowthQuery,
  ): { records: GrowthStoredRecord[]; nextCursor: string | null; hasNext: boolean } {
    const limit = this.normaliseLimit(query.limit);
    const filtered = this.sorted(this.recordsFor(studentId)).filter((record) => {
      if (query.type !== 'all' && record.type !== query.type) return false;
      if (query.projectId !== null && record.projectId !== query.projectId) return false;
      if (query.from !== null && record.occurredAt < query.from) return false;
      if (query.to !== null && record.occurredAt > query.to) return false;
      return true;
    });

    let start = 0;
    if (query.cursor !== null) {
      const index = filtered.findIndex((record) => record.id === query.cursor);
      // 未知游标按「从头开始」处理，而不是报错：旧链接仍然可用。
      start = index === -1 ? 0 : index + 1;
    }

    const records = filtered.slice(start, start + limit);
    const hasNext = start + limit < filtered.length;
    return {
      records,
      nextCursor: hasNext && records.length > 0 ? records[records.length - 1]!.id : null,
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
    const all = this.recordsFor(childId);
    const page = this.queryRecords(childId, query);

    // 显示名从目录取，而不是本地硬编码——目录是身份的唯一真相。
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
        items: page.records.map((record) => this.toParentEntry(record)),
        nextCursor: page.nextCursor,
        hasNext: page.hasNext,
      },
    };
  }

  /* --------------------------- 写：仅服务端 --------------------------- */

  /**
   * 服务端内部写入。控制器**不**暴露这个能力——成长档案不能由客户端写。
   *
   * 只追加 + 幂等：同一 `idempotencyKey`（缺省由内容派生）重试只落一条；命中
   * 已存在记录时返回既有投影，不重复写入。
   */
  async record(input: GrowthRecordInput): Promise<StudentGrowthEntry> {
    const projectTitle =
      input.projectTitle ??
      (input.projectId === undefined || input.projectId === null
        ? null
        : (PROJECT_TITLES[input.projectId] ?? input.projectId));

    const stored = buildGrowthStoredRecord({ ...input, projectTitle }, new Date().toISOString());
    const { record } = await this.store.append(stored);
    this.cacheRecord(record);
    return this.toStudentEntry(record);
  }

  /* ------------------------------ 内部 ------------------------------ */

  private recordsFor(studentId: string): GrowthStoredRecord[] {
    return this.records.get(studentId) ?? [];
  }

  /** 把一条规范记录放进快照；按 id 去重，重复只追加不会产生两条。 */
  private cacheRecord(record: GrowthStoredRecord): void {
    let list = this.records.get(record.studentId);
    if (list === undefined) {
      list = [];
      this.records.set(record.studentId, list);
    }
    if (list.some((existing) => existing.id === record.id)) return;
    list.push(record);
  }

  private sorted(records: readonly GrowthStoredRecord[]): GrowthStoredRecord[] {
    return [...records].sort((a, b) => {
      if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
  }

  private toStudentEntry(record: GrowthStoredRecord): StudentGrowthEntry {
    return {
      id: record.id,
      type: record.type,
      occurredAt: record.occurredAt,
      title: record.title,
      summaryStudent: record.summaryStudent,
      projectId: record.projectId,
      projectTitle: record.projectTitle,
      stage: record.stage,
      artifactRef: record.artifactRef,
      objectiveTitles: [...record.objectiveTitles],
      icon: ICON_BY_TYPE[record.type],
      encouragement: record.encouragement,
      evidenceIds: [...record.evidenceIds],
      observationState: observationStateFor(record.evidenceIds),
    };
  }

  private toParentEntry(record: GrowthStoredRecord): ParentGrowthEntry {
    return {
      id: record.id,
      type: record.type,
      occurredAt: record.occurredAt,
      title: record.title,
      // 家长文案独立取用；规范表里 `summary_parent` 与 `summary_student` 并列存放。
      summaryParent: record.summaryParent,
      projectTitle: record.projectTitle,
      stage: record.stage,
      artifactRef: record.artifactRef,
    };
  }

  private normaliseLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(limit), MAX_LIMIT);
  }

  private countCompletedProjects(records: readonly GrowthStoredRecord[]): number {
    const completed = new Set<string>();
    for (const record of records) {
      if (record.projectId === null) continue;
      if (record.stage === null) continue;
      if (!TERMINAL_STAGES.has(record.stage)) continue;
      completed.add(record.projectId);
    }
    return completed.size;
  }

  /** 连续天数：从最近一天往回数，必须是连续的自然日。 */
  private computeStreak(records: readonly GrowthStoredRecord[]): number {
    const days = new Set(records.map((record) => record.occurredAt.slice(0, 10)));
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
   * 演示学生的既有成长档案（仅非持久化 / 非 live）。
   *
   * 时间是**相对当前时间**生成的，所以「连续天数」在任何一天打开都不是 0，
   * 也不会随着代码老化而变成几个月前。幂等键显式给出，因此这是一个确定性
   * fixture，可由 `InMemoryGrowthRecordStore.seed` 幂等灌入。
   */
  private buildDemoRecords(): GrowthStoredRecord[] {
    const daysAgo = (days: number, hour = 16): string => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - days);
      date.setUTCHours(hour, 0, 0, 0);
      return date.toISOString();
    };
    const demo = (input: GrowthRecordInput): GrowthStoredRecord =>
      buildGrowthStoredRecord(
        { ...input, projectTitle: input.projectId ? (PROJECT_TITLES[input.projectId] ?? null) : null },
        input.occurredAt,
      );

    return [
      demo({
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
        idempotencyKey: 'growth:demo:reflection:demo-001',
      }),
      demo({
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
        idempotencyKey: 'growth:demo:artifact:demo-001',
      }),
      demo({
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
        idempotencyKey: 'growth:demo:objective:photosynthesis',
      }),
      demo({
        studentId: 'student-demo',
        type: 'project_stage_completed',
        occurredAt: daysAgo(4, 14),
        title: '完成「理论闯关」阶段',
        summaryStudent: '理论部分全部通过，你准备好动手做观察手册了。',
        summaryParent: '孩子完成了项目的理论阶段，进入实践准备。',
        projectId: 'project-demo-001',
        stage: 'practice_ready',
        evidenceIds: ['theory_check:theory-demo-002'],
        idempotencyKey: 'growth:demo:stage:practice_ready',
      }),
      demo({
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
        idempotencyKey: 'growth:demo:objective:observation-elements',
      }),
      demo({
        studentId: 'student-demo',
        type: 'project_stage_completed',
        occurredAt: daysAgo(6, 11),
        title: '确认项目方向：校园植物观察手册',
        summaryStudent: '你决定做一个校园植物观察手册，方向是你自己选的。',
        summaryParent: '孩子确认了自己的项目方向。',
        projectId: 'project-demo-001',
        stage: 'intent_confirmed',
        idempotencyKey: 'growth:demo:stage:intent_confirmed',
      }),
    ];
  }
}
