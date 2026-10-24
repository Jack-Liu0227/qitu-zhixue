import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import {
  artifactVersions, artifacts, explorationSessions, intentConfirmations, learningSessionProgress,
  masteryAttempts, projectEvidence, tutorSessions, tutorTurns, type Database,
} from '@qitu/database';
import type { GrowthCompetencyDimensionId } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { activityWeekStart, summarizeLearningActivity } from './learning-activity';

export type CompetencyObservations = Partial<Record<GrowthCompetencyDimensionId, string[]>>;

@Injectable()
export class LearningInsightsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null) {}

  async activity(studentId: string, now = new Date()) {
    const db = this.requireDatabase();
    const from = new Date(activityWeekStart(now) - 7 * 86_400_000);
    const [turns, attempts, evidence, completions] = await Promise.all([
      db.select({ at: tutorTurns.createdAt }).from(tutorTurns)
        .innerJoin(tutorSessions, eq(tutorTurns.sessionId, tutorSessions.id))
        .where(and(eq(tutorTurns.studentId, studentId), eq(tutorSessions.studentId, studentId),
          eq(tutorTurns.role, 'student'), gte(tutorTurns.createdAt, from), lte(tutorTurns.createdAt, now))),
      db.select({ at: masteryAttempts.createdAt }).from(masteryAttempts).where(and(
        eq(masteryAttempts.studentUserId, studentId), gte(masteryAttempts.createdAt, from), lte(masteryAttempts.createdAt, now))),
      db.select({ at: projectEvidence.occurredAt }).from(projectEvidence).where(and(
        eq(projectEvidence.studentUserId, studentId), gte(projectEvidence.occurredAt, from), lte(projectEvidence.occurredAt, now))),
      db.select({ at: learningSessionProgress.completedAt }).from(learningSessionProgress).where(and(
        eq(learningSessionProgress.studentUserId, studentId), gte(learningSessionProgress.completedAt, from), lte(learningSessionProgress.completedAt, now))),
    ]);
    return summarizeLearningActivity([...turns, ...attempts, ...evidence].map(row => row.at), completions.map(row => row.at), now);
  }

  /** Explicit factual mapping, learning-footprints.v1; no ability assessment and no text inference. */
  async competencyObservations(studentId: string): Promise<CompetencyObservations> {
    const db = this.requireDatabase();
    const [intents, turns, attempts, versions, observations, reflections] = await Promise.all([
      db.select({ id: intentConfirmations.id }).from(intentConfirmations)
        .innerJoin(explorationSessions, eq(intentConfirmations.explorationId, explorationSessions.id))
        .where(and(eq(explorationSessions.studentUserId, studentId), eq(explorationSessions.status, 'confirmed'), isNotNull(intentConfirmations.confirmedAt)))
        .orderBy(desc(intentConfirmations.confirmedAt)).limit(32),
      db.select({ id: tutorTurns.id }).from(tutorTurns).innerJoin(tutorSessions, eq(tutorTurns.sessionId, tutorSessions.id))
        .where(and(eq(tutorTurns.studentId, studentId), eq(tutorSessions.studentId, studentId), eq(tutorTurns.role, 'student')))
        .orderBy(desc(tutorTurns.createdAt)).limit(32),
      db.select({ id: masteryAttempts.id }).from(masteryAttempts).where(eq(masteryAttempts.studentUserId, studentId))
        .orderBy(desc(masteryAttempts.createdAt)).limit(32),
      db.select({ id: artifactVersions.id }).from(artifactVersions).innerJoin(artifacts, eq(artifactVersions.artifactId, artifacts.id))
        .where(eq(artifacts.studentUserId, studentId)).orderBy(desc(artifactVersions.createdAt)).limit(32),
      db.select({ id: projectEvidence.sourceId }).from(projectEvidence)
        .where(and(eq(projectEvidence.studentUserId, studentId), eq(projectEvidence.sourceKind, 'experiment_observation')))
        .orderBy(desc(projectEvidence.occurredAt)).limit(32),
      db.select({ id: projectEvidence.sourceId }).from(projectEvidence)
        .where(and(eq(projectEvidence.studentUserId, studentId), eq(projectEvidence.sourceKind, 'reflection')))
        .orderBy(desc(projectEvidence.occurredAt)).limit(32),
    ]);
    return {
      problem_discovery: intents.map(row => `intent_confirmation:${row.id}`),
      scientific_inquiry: observations.map(row => `experiment_observation:${row.id}`),
      logical_modeling: attempts.map(row => `student_answer:${row.id}`),
      practical_creation: versions.map(row => `artifact:${row.id}`),
      collaborative_expression: turns.map(row => `learning_interaction:${row.id}`),
      reflection_transfer: reflections.map(row => `reflection:${row.id}`),
    };
  }

  private requireDatabase() {
    if (!this.db) throw new ServiceUnavailableException({ code: 'LEARNING_INSIGHTS_UNAVAILABLE', message: '学习记录暂时无法读取，请稍后重试' });
    return this.db;
  }
}
