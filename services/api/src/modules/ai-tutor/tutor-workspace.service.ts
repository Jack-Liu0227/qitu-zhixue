import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  TutorGrowthSignal,
  TutorKnowledgeDocument,
  TutorKnowledgeSearchResult,
  TutorLearnerProfile,
  TutorMemory,
  TutorPartnerProfile,
  TutorSdkPorts,
  TutorTemplateDocument,
  TutorTemplateSearchResult,
} from '@qitu/ai-client';

import type { Database } from '@qitu/database';
import {
  tutorGrowthSignals,
  tutorKnowledgeDocuments,
  tutorLearnerProfiles,
  tutorMemories,
  tutorPartners,
  tutorTemplateDocuments,
} from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';

/** PostgreSQL adapter for the pure Tutor SDK. */
@Injectable()
export class TutorWorkspaceService implements TutorSdkPorts {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null) {}

  async loadLearnerProfile(studentId: string): Promise<TutorLearnerProfile | null> {
    if (this.db === null) return null;
    const rows = await this.db
      .select()
      .from(tutorLearnerProfiles)
      .where(eq(tutorLearnerProfiles.studentId, studentId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      studentId: row.studentId,
      priorKnowledge: row.priorKnowledge,
      targetLevel: row.targetLevel,
      timeBudgetMinutesPerWeek: row.timeBudgetMinutesPerWeek,
      preferences: row.preferences,
      interests: row.interests,
      strengths: row.strengths,
      nextQuestions: row.nextQuestions,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listMemories(input: {
    studentId: string;
    partnerId: 'qitu-learning-partner';
    limit: number;
  }): Promise<readonly TutorMemory[]> {
    if (this.db === null) return [];
    const rows = await this.db
      .select()
      .from(tutorMemories)
      .where(eq(tutorMemories.studentId, input.studentId))
      .limit(Math.max(1, Math.min(input.limit, 20)));
    return rows
      .filter((row) => row.partnerId === input.partnerId)
      .map((row) => ({
        id: row.id,
        studentId: row.studentId,
        partnerId: 'qitu-learning-partner' as const,
        kind: row.kind as TutorMemory['kind'],
        content: row.content,
        confidence: row.confidence / 10000,
        source: row.source as TutorMemory['source'],
        visibility: row.visibility as TutorMemory['visibility'],
        updatedAt: row.updatedAt.toISOString(),
      }));
  }

  async searchTemplates(input: {
    studentId: string;
    projectId: string | null;
    query: string;
    limit: number;
  }): Promise<readonly TutorTemplateSearchResult[]> {
    if (this.db === null) return [];
    const rows = await this.db.select().from(tutorTemplateDocuments);
    const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    return rows
      .filter((row) => row.active)
      .filter((row) => row.scope === 'system' || row.studentId === input.studentId || row.projectId === input.projectId)
      .map((row) => {
        const haystack = `${row.title} ${row.summary} ${row.tags.join(' ')} ${row.content}`.toLowerCase();
        const matchedTerms = terms.filter((term) => haystack.includes(term));
        return {
          document: {
            id: row.id,
            version: row.version,
            title: row.title,
            summary: row.summary,
            tags: row.tags,
            stage: row.stage as TutorTemplateSearchResult['document']['stage'],
            content: row.content,
            scope: row.scope as TutorTemplateSearchResult['document']['scope'],
            active: row.active,
          },
          score: terms.length === 0 ? 0 : matchedTerms.length / terms.length,
          matchedTerms,
        };
      })
      .filter((result) => result.score > 0 || terms.length === 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(input.limit, 8)));
  }

  async searchKnowledge(input: {
    studentId: string;
    projectId: string | null;
    query: string;
    limit: number;
  }): Promise<readonly TutorKnowledgeSearchResult[]> {
    if (this.db === null) return [];
    const rows = await this.db.select().from(tutorKnowledgeDocuments);
    return rankDocuments(rows, input).slice(0, Math.max(1, Math.min(input.limit, 8))).map((result) => ({
      document: result.document,
      score: result.score,
      matchedTerms: result.matchedTerms,
    }));
  }

  async ensurePartner(partner: TutorPartnerProfile): Promise<void> {
    if (this.db === null) return;
    await this.db.insert(tutorPartners).values({
      id: partner.id,
      displayName: partner.displayName,
      soul: partner.soul,
      modelUsage: partner.modelUsage,
      promptVersion: partner.promptVersion,
      capabilities: [...partner.capabilities],
    }).onConflictDoUpdate({
      target: tutorPartners.id,
      set: {
        displayName: partner.displayName,
        soul: partner.soul,
        modelUsage: partner.modelUsage,
        promptVersion: partner.promptVersion,
        capabilities: [...partner.capabilities],
        updatedAt: new Date(),
      },
    });
  }

  async upsertTemplate(document: TutorTemplateDocument): Promise<void> {
    if (this.db === null) return;
    await this.db.insert(tutorTemplateDocuments).values({
      id: document.id,
      version: document.version,
      title: document.title,
      summary: document.summary,
      tags: [...document.tags],
      stage: document.stage,
      content: document.content,
      scope: document.scope,
      active: document.active,
      studentId: document.scope === 'student' ? undefined : null,
      projectId: document.scope === 'project' ? undefined : null,
    }).onConflictDoUpdate({
      target: tutorTemplateDocuments.id,
      set: {
        version: document.version,
        title: document.title,
        summary: document.summary,
        tags: [...document.tags],
        stage: document.stage,
        content: document.content,
        scope: document.scope,
        active: document.active,
        updatedAt: new Date(),
      },
    });
  }

  async upsertKnowledge(document: TutorKnowledgeDocument): Promise<void> {
    if (this.db === null) return;
    await this.db.insert(tutorKnowledgeDocuments).values({
      id: document.id,
      version: document.version,
      title: document.title,
      summary: document.summary,
      tags: [...document.tags],
      content: document.content,
      source: document.source,
      scope: document.scope,
      active: document.active,
    }).onConflictDoUpdate({
      target: tutorKnowledgeDocuments.id,
      set: {
        version: document.version,
        title: document.title,
        summary: document.summary,
        tags: [...document.tags],
        content: document.content,
        source: document.source,
        scope: document.scope,
        active: document.active,
        updatedAt: new Date(),
      },
    });
  }

  async upsertLearnerProfile(profile: TutorLearnerProfile): Promise<void> {
    if (this.db === null) return;
    await this.db.insert(tutorLearnerProfiles).values({
      studentId: profile.studentId,
      priorKnowledge: profile.priorKnowledge,
      targetLevel: profile.targetLevel,
      timeBudgetMinutesPerWeek: profile.timeBudgetMinutesPerWeek,
      preferences: [...profile.preferences],
      interests: [...profile.interests],
      strengths: [...profile.strengths],
      nextQuestions: [...profile.nextQuestions],
      version: profile.version,
      updatedAt: new Date(profile.updatedAt),
    }).onConflictDoUpdate({
      target: tutorLearnerProfiles.studentId,
      set: {
        priorKnowledge: profile.priorKnowledge,
        targetLevel: profile.targetLevel,
        timeBudgetMinutesPerWeek: profile.timeBudgetMinutesPerWeek,
        preferences: [...profile.preferences],
        interests: [...profile.interests],
        strengths: [...profile.strengths],
        nextQuestions: [...profile.nextQuestions],
        version: profile.version,
        updatedAt: new Date(profile.updatedAt),
      },
    });
  }

  async appendGrowthSignal(signal: TutorGrowthSignal): Promise<void> {
    if (this.db === null) return;
    await this.db
      .insert(tutorGrowthSignals)
      .values({
        id: `growth-signal-${signal.idempotencyKey}`,
        idempotencyKey: signal.idempotencyKey,
        studentId: signal.studentId,
        projectId: signal.projectId,
        kind: signal.kind,
        summary: signal.summary,
        evidenceRef: signal.evidenceRef,
        occurredAt: new Date(signal.occurredAt),
      })
      .onConflictDoNothing({ target: tutorGrowthSignals.idempotencyKey });
  }

  async upsertMemory(memory: TutorMemory): Promise<void> {
    if (this.db === null) return;
    await this.db.insert(tutorMemories).values({
      id: memory.id,
      studentId: memory.studentId,
      partnerId: memory.partnerId,
      kind: memory.kind,
      content: memory.content,
      confidence: Math.round(memory.confidence * 10000),
      source: memory.source,
      visibility: memory.visibility,
      updatedAt: new Date(memory.updatedAt),
    }).onConflictDoNothing({ target: tutorMemories.id });
  }
}

function rankDocuments(
  rows: readonly (typeof tutorKnowledgeDocuments.$inferSelect)[],
  input: { studentId: string; projectId: string | null; query: string },
): TutorKnowledgeSearchResult[] {
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows
    .filter((row) => row.active)
    .filter((row) => row.scope === 'system' || row.studentId === input.studentId || row.projectId === input.projectId)
    .map((row) => {
      const haystack = `${row.title} ${row.summary} ${row.tags.join(' ')} ${row.content}`.toLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      return {
        document: {
          id: row.id,
          version: row.version,
          title: row.title,
          summary: row.summary,
          tags: row.tags,
          content: row.content,
          source: row.source,
          scope: row.scope as TutorKnowledgeDocument['scope'],
          active: row.active,
        },
        score: terms.length === 0 ? 0 : matchedTerms.length / terms.length,
        matchedTerms,
      };
    })
    .filter((result) => result.score > 0 || terms.length === 0)
    .sort((left, right) => right.score - left.score);
}
