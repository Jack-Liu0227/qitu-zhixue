import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CurrentUser,
  MasteryCurrentView,
  MasteryReadCurrentRequest,
  MasteryReadRegressionRequest,
  MasteryReadSnapshotRequest,
  MasteryReadThresholdRequest,
  MasteryReadTimelineRequest,
  MasteryRegression,
  MasterySnapshot,
  MasteryThresholdView,
  MasteryTimelinePoint,
  MasteryTimelineView,
} from '@qitu/contracts';
import { AccessPolicy } from '../../common/access/access-policy';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import {
  MASTERY_READ_THRESHOLD,
  masteryAggregateKey,
  projectMasteryEvents,
  selectMasteryAt,
  toMasteryCurrent,
  type MasteryProjectedEvent,
} from './mastery.projection';
import { masteryDate, masteryId, masteryInputError, masteryLimit } from './mastery.validation';

type AuthorizedQuery<T> = T & { studentId?: string };

@Injectable()
export class MasteryReadService {
  constructor(
    private readonly store: LearningPlanStore,
    private readonly access: AccessPolicy,
  ) {}

  async getCurrent(
    actor: CurrentUser,
    input: AuthorizedQuery<MasteryReadCurrentRequest>,
  ): Promise<MasteryCurrentView> {
    const studentId = await this.resolveStudent(actor, input.studentId);
    const now = new Date();
    const validAt = masteryDate(input.validAt, now);
    const knownAt = masteryDate(input.knownAt, now);
    const projected = await this.projected(
      studentId,
      knownAt,
      input.knowledgePointId,
      input.courseVersion,
    );
    return {
      current: selectMasteryAt(projected, validAt).map(toMasteryCurrent),
      validAt: validAt.toISOString(),
      knownAt: knownAt.toISOString(),
    };
  }

  async getTimeline(
    actor: CurrentUser,
    input: AuthorizedQuery<MasteryReadTimelineRequest>,
  ): Promise<MasteryTimelineView> {
    const studentId = await this.resolveStudent(actor, input.studentId);
    const knownAt = masteryDate(input.knownAt, new Date());
    const validAt = input.validAt == null ? null : masteryDate(input.validAt);
    const knowledgePointId = masteryId(input.knowledgePointId, true)!;
    const limit = masteryLimit(input.limit);
    const projected = await this.projected(
      studentId,
      knownAt,
      knowledgePointId,
      input.courseVersion,
    );
    const points = projected
      .filter((item) => validAt === null || item.event.validFrom <= validAt)
      .map((item) => item.point);
    let offset = 0;
    if (input.cursor != null) {
      const cursor = masteryId(input.cursor, true)!;
      const position = points.findIndex((point) => point.eventId === cursor);
      if (position < 0) throw masteryInputError('cursor 不属于当前查询');
      offset = position + 1;
    }
    const items = points.slice(offset, offset + limit);
    const hasNext = offset + items.length < points.length;
    return {
      items: items.map((point) => this.visiblePoint(actor, point)),
      nextCursor: hasNext ? items.at(-1)!.eventId : null,
      hasNext,
    };
  }

  async getSnapshot(
    actor: CurrentUser,
    input: AuthorizedQuery<MasteryReadSnapshotRequest>,
  ): Promise<MasterySnapshot> {
    const studentId = await this.resolveStudent(actor, input.studentId);
    const validAt = masteryDate(input.validAt);
    const knownAt = masteryDate(input.knownAt, new Date());
    if (
      input.knowledgePointIds != null &&
      (!Array.isArray(input.knowledgePointIds) || input.knowledgePointIds.length > 100)
    ) {
      throw masteryInputError('knowledgePointIds 最多包含 100 个标识');
    }
    const ids =
      input.knowledgePointIds == null
        ? null
        : new Set(input.knowledgePointIds.map((id) => masteryId(id, true)!));
    const all = await this.projected(studentId, knownAt);
    const selected = selectMasteryAt(
      ids === null ? all : all.filter((item) => ids.has(item.event.knowledgePointId)),
      validAt,
    );
    const versions = new Set(selected.map((item) => item.event.assessmentVersion));
    return {
      studentId,
      validAt: validAt.toISOString(),
      knownAt: knownAt.toISOString(),
      sourceSequence: Math.max(0, ...selected.map((item) => item.event.sequence)),
      assessmentVersion:
        versions.size === 0 ? 'unknown' : versions.size === 1 ? [...versions][0]! : 'mixed',
      freshness: 'fresh',
      points: selected.map(({ event, point }) => ({
        knowledgePointId: event.knowledgePointId,
        courseVersion: event.courseVersion,
        knowledgeType: event.knowledgeType,
        score: point.score,
        confidence: point.confidence,
        qualitativeMastered: point.qualitativeMastered,
        status: point.status,
        sourceEventId: event.id,
        sequence: event.sequence,
      })),
    };
  }

  async getThreshold(
    actor: CurrentUser,
    input: AuthorizedQuery<MasteryReadThresholdRequest>,
  ): Promise<MasteryThresholdView> {
    const studentId = await this.resolveStudent(actor, input.studentId);
    const now = new Date();
    const validAt = masteryDate(input.validAt, now);
    const knownAt = masteryDate(input.knownAt, now);
    const knowledgePointId = masteryId(input.knowledgePointId, true)!;
    const all = await this.projected(studentId, knownAt, knowledgePointId, input.courseVersion);
    const versions = new Set(all.map((item) => item.event.courseVersion));
    if (versions.size > 1) {
      throw new ConflictException({
        code: 'MASTERY_VERSION_MISMATCH',
        message: '存在多个课程版本，请指定 courseVersion',
      });
    }
    const selected = selectMasteryAt(all, validAt)[0];
    const definition = selected ?? all[0];
    if (!definition)
      throw new NotFoundException({ code: 'MASTERY_NOT_FOUND', message: '没有已知的掌握评估' });
    const current = selected ? toMasteryCurrent(selected) : null;
    const quantitative =
      definition.event.knowledgeType === 'memory' || definition.event.knowledgeType === 'procedure';
    const met =
      current !== null &&
      (quantitative
        ? current.score !== null && current.score >= MASTERY_READ_THRESHOLD
        : current.qualitativeMastered === true);
    return {
      threshold: {
        studentId,
        knowledgePointId,
        courseVersion: definition.event.courseVersion,
        threshold: {
          knowledgePointId,
          courseVersion: definition.event.courseVersion,
          knowledgeType: definition.event.knowledgeType,
          kind: quantitative ? 'quantitative' : 'qualitative',
          value: quantitative ? MASTERY_READ_THRESHOLD : null,
          assessmentVersion: definition.event.assessmentVersion,
        },
        current,
        met,
        reason:
          current === null ? '当前没有掌握评估' : met ? '已达到服务端门槛' : '尚未达到服务端门槛',
        checkedAt: now.toISOString(),
      },
    };
  }

  async getRegressionAlerts(
    actor: CurrentUser,
    input: AuthorizedQuery<MasteryReadRegressionRequest>,
  ): Promise<{ items: MasteryRegression[] }> {
    const studentId = await this.resolveStudent(actor, input.studentId);
    const now = new Date();
    const knownAt = masteryDate(input.knownAt, now);
    const since = input.since == null ? null : masteryDate(input.since);
    const limit = masteryLimit(input.limit);
    const projected = await this.projected(studentId, knownAt, input.knowledgePointId);
    const previous = new Map<string, MasteryProjectedEvent>();
    const result: MasteryRegression[] = [];
    for (const item of projected) {
      const key = masteryAggregateKey(item.event.knowledgePointId, item.event.courseVersion);
      const from = previous.get(key);
      previous.set(key, item);
      if (!from || item.event.validFrom > now || (since !== null && item.event.validFrom < since))
        continue;
      if (
        from.point.assessmentVersion !== item.point.assessmentVersion ||
        from.point.knowledgeType !== item.point.knowledgeType
      )
        continue;
      // Unknown/revoked states require reassessment, not a claim of measured regression.
      const quantitative =
        item.point.knowledgeType === 'memory' || item.point.knowledgeType === 'procedure';
      const known = quantitative
        ? from.point.score !== null && item.point.score !== null
        : from.point.qualitativeMastered !== null && item.point.qualitativeMastered !== null;
      if (!known) continue;
      const scoreDrop = quantitative && item.point.score! < from.point.score!;
      const masteryLost = from.point.status === 'mastered' && item.point.status !== 'mastered';
      if (!scoreDrop && !masteryLost) continue;
      result.push({
        studentId,
        knowledgePointId: item.event.knowledgePointId,
        courseVersion: item.event.courseVersion,
        kind: masteryLost ? 'mastery_lost' : 'score_drop',
        from: this.visiblePoint(actor, from.point),
        to: this.visiblePoint(actor, item.point),
        detectedAt: now.toISOString(),
      });
    }
    result.sort((a, b) => b.to.validFrom.localeCompare(a.to.validFrom));
    return { items: result.slice(0, limit) };
  }

  private async resolveStudent(actor: CurrentUser, requested?: string): Promise<string> {
    const studentId = masteryId(requested) ?? actor.id;
    if (!(await this.access.canReadStudent(actor, studentId))) {
      throw new ForbiddenException({
        code: 'MASTERY_FORBIDDEN',
        message: '无权访问该学生的掌握度',
      });
    }
    return studentId;
  }

  private async projected(
    studentId: string,
    knownAt: Date,
    knowledgePointId?: string | null,
    courseVersion?: string | null,
  ): Promise<MasteryProjectedEvent[]> {
    const kp = masteryId(knowledgePointId);
    const version = masteryId(courseVersion);
    const events = await this.store.listMasteryEvents({
      studentUserId: studentId,
      knowledgePointId: kp,
      courseVersion: version,
      recordedAt: knownAt,
    });
    return projectMasteryEvents(events, knownAt);
  }

  private visiblePoint(actor: CurrentUser, point: MasteryTimelinePoint): MasteryTimelinePoint {
    return { ...point, evidenceRefs: actor.role === 'parent' ? [] : [...point.evidenceRefs] };
  }
}
