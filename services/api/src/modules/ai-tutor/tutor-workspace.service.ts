import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type {
  TutorGrowthSignal,
  TutorKnowledgeDocument,
  TutorKnowledgeSearchResult,
  TutorTemplateSearchResult,
  TutorLearnerProfile,
  TutorMemory,
  TutorPartnerProfile,
  TutorContextReadPorts,
  TutorDomainWritePorts,
} from '@qitu/ai-client';

import type { Database } from '@qitu/database';
import { QITU_LEARNING_PARTNER } from '@qitu/ai-client';
import {
  tutorGrowthSignals,
  tutorKnowledgeDocuments,
  tutorLearnerProfiles,
  tutorMemories,
  tutorPartners,
  projectTemplates,
  projectTemplateVersions,
  agentMemoryRecords,
} from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';

/** PostgreSQL adapter for the pure Tutor SDK. */
@Injectable()
export class TutorWorkspaceService implements TutorContextReadPorts, TutorDomainWritePorts {
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
    partnerId: string;
    limit: number;
  }): Promise<readonly TutorMemory[]> {
    if (this.db === null) return [];
    const [tutorRows, agentRows] = await Promise.all([
      this.db.select().from(tutorMemories)
        .where(and(eq(tutorMemories.studentId, input.studentId), eq(tutorMemories.partnerId, input.partnerId)))
        .orderBy(desc(tutorMemories.updatedAt)).limit(Math.max(1, Math.min(input.limit, 20))),
      this.db.select().from(agentMemoryRecords).where(and(
        eq(agentMemoryRecords.studentId, input.studentId), eq(agentMemoryRecords.partnerId, input.partnerId),
        eq(agentMemoryRecords.scope, 'relationship'), eq(agentMemoryRecords.status, 'active'),
        or(isNull(agentMemoryRecords.expiresAt), gt(agentMemoryRecords.expiresAt, new Date())),
      )).orderBy(desc(agentMemoryRecords.updatedAt)).limit(Math.max(1, Math.min(input.limit, 20))),
    ]);
    const workspaceMemories = tutorRows.map((row) => ({
      id: row.id, studentId: row.studentId, partnerId: row.partnerId, kind: row.kind as TutorMemory['kind'], content: row.content,
      confidence: row.confidence / 10000, source: row.source as TutorMemory['source'], visibility: row.visibility as TutorMemory['visibility'], updatedAt: row.updatedAt.toISOString(),
    }));
    const agent = agentRows
      .filter((row): row is typeof row & { kind: 'preference' | 'interest' | 'goal' } => row.kind === 'preference' || row.kind === 'interest' || row.kind === 'goal')
      .map((row) => ({
        id: row.id, studentId: row.studentId!, partnerId: row.partnerId, kind: row.kind as TutorMemory['kind'], content: row.content,
        confidence: 1, source: 'student' as const, visibility: 'student_private' as const, updatedAt: row.updatedAt.toISOString(),
      }));
    return [...agent, ...workspaceMemories].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.max(1, Math.min(input.limit, 20)));
  }

  async listAgentStrategies(input: {
    partnerId: string;
    limit: number;
  }): Promise<readonly { content: string; source: string }[]> {
    if (this.db === null) return [];
    const rows = await this.db.select({ content: agentMemoryRecords.content, source: agentMemoryRecords.sourceRef })
      .from(agentMemoryRecords)
      .where(and(
        eq(agentMemoryRecords.partnerId, input.partnerId),
        isNull(agentMemoryRecords.studentId),
        eq(agentMemoryRecords.scope, 'agent'),
        eq(agentMemoryRecords.status, 'active'),
        or(isNull(agentMemoryRecords.expiresAt), gt(agentMemoryRecords.expiresAt, new Date())),
      ))
      .orderBy(desc(agentMemoryRecords.updatedAt))
      .limit(Math.max(1, Math.min(input.limit, 8)));
    return rows.map((row) => ({ content: row.content, source: row.source ?? 'agent-memory' }));
  }

  async searchTemplates(input: {
    studentId: string;
    projectId: string | null;
    query: string;
    limit: number;
  }): Promise<readonly TutorTemplateSearchResult[]> {
    if (this.db === null) return [];
    const rows = await this.db
      .select({ template: projectTemplates, version: projectTemplateVersions })
      .from(projectTemplateVersions)
      .innerJoin(projectTemplates, eq(projectTemplateVersions.templateId, projectTemplates.id))
      .where(and(
        eq(projectTemplates.status, 'published'),
        eq(projectTemplateVersions.status, 'published'),
        // 平台模板是所有学生都可见的安全基础；校级模板待接入 student school projection。
        isNull(projectTemplates.schoolId),
      ));
    const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    return rows
      .map(({ template, version }) => {
        const tags = [template.domain, template.difficulty].filter((value): value is string => value !== null && value.length > 0);
        const content = JSON.stringify({
          stages: version.stages,
          content: version.content,
          rubric: version.rubric,
        });
        const haystack = `${template.title} ${template.summary} ${tags.join(' ')} ${content}`.toLowerCase();
        const matchedTerms = terms.filter((term) => haystack.includes(term));
        return {
          document: {
            // The student must carry the governed version id into exploration creation.
            id: version.id,
            version: version.version,
            title: template.title,
            summary: template.summary,
            tags,
            stage: 'exploration' as const,
            content,
            scope: 'system' as const,
            active: true,
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
    return rankDocuments(rows, input).slice(0, Math.max(1, Math.min(input.limit, 8)));
  }

  async getPartnerProfile(partnerId: string): Promise<TutorPartnerProfile> {
    if (this.db === null) return QITU_LEARNING_PARTNER;
    const [row] = await this.db.select().from(tutorPartners).where(eq(tutorPartners.id, partnerId)).limit(1);
    if (!row) return QITU_LEARNING_PARTNER;
    const capabilities = row.capabilities.filter((item): item is TutorPartnerProfile['capabilities'][number] =>
      item === 'explore' || item === 'plan' || item === 'teach' || item === 'review' || item === 'reflect');
    return {
      id: row.id, displayName: row.displayName, soul: row.soul,
      roleDefinition: row.roleDefinition || QITU_LEARNING_PARTNER.roleDefinition,
      enabled: row.enabled,
      modelUsage: row.modelUsage, promptVersion: row.promptVersion,
      capabilities: capabilities.length > 0 ? capabilities : QITU_LEARNING_PARTNER.capabilities,
    };
  }
  async ensurePartner(partner: TutorPartnerProfile): Promise<void> {
    if (this.db === null) return;
    await this.db.insert(tutorPartners).values({
      id: partner.id,
      displayName: partner.displayName,
      soul: partner.soul,
      roleDefinition: partner.roleDefinition,
      enabled: partner.enabled,
      modelUsage: partner.modelUsage,
      promptVersion: partner.promptVersion,
      capabilities: [...partner.capabilities],
    }).onConflictDoNothing({ target: tutorPartners.id });
  }

  async commitGrowthSignal(signal: TutorGrowthSignal): Promise<void> {
    if (this.db === null) return;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`growth:${signal.studentId}`}, 0))`);
      const inserted = await tx.insert(tutorGrowthSignals).values({
        id: `growth-signal-${signal.idempotencyKey}`, idempotencyKey: signal.idempotencyKey,
        studentId: signal.studentId, projectId: signal.projectId, kind: signal.kind,
        summary: signal.summary, evidenceRef: signal.evidenceRef, occurredAt: new Date(signal.occurredAt),
      }).onConflictDoNothing({ target: tutorGrowthSignals.idempotencyKey }).returning({ id: tutorGrowthSignals.id });
      if (inserted.length === 0) return;
      const rows = await tx.select().from(tutorLearnerProfiles).where(eq(tutorLearnerProfiles.studentId, signal.studentId)).limit(1);
      const row = rows[0];
      const profile: TutorLearnerProfile = row === undefined ? {
        studentId: signal.studentId, priorKnowledge: null, targetLevel: null, timeBudgetMinutesPerWeek: null,
        preferences: [], interests: [], strengths: [], nextQuestions: [], version: 0, updatedAt: signal.occurredAt,
      } : { ...row, updatedAt: row.updatedAt.toISOString() };
      const next = applyGrowthSignalToProfile(profile, signal);
      const values = { ...next, preferences: [...next.preferences], interests: [...next.interests],
        strengths: [...next.strengths], nextQuestions: [...next.nextQuestions], updatedAt: new Date(next.updatedAt) };
      await tx.insert(tutorLearnerProfiles).values(values).onConflictDoUpdate({ target: tutorLearnerProfiles.studentId, set: values });
    });
  }
}

function applyGrowthSignalToProfile(profile: TutorLearnerProfile, signal: TutorGrowthSignal): TutorLearnerProfile {
  const interests = signal.kind === 'interest_signal'
    ? unique([...profile.interests, signal.summary]).slice(-12)
    : profile.interests;
  const strengths = signal.kind === 'artifact_created' || signal.kind === 'theory_mastered'
    ? unique([...profile.strengths, signal.summary]).slice(-12)
    : profile.strengths;
  const nextQuestions = signal.kind === 'question_asked'
    ? unique([...profile.nextQuestions, signal.summary]).slice(-12)
    : profile.nextQuestions;
  return {
    ...profile,
    interests,
    strengths,
    nextQuestions,
    version: profile.version + 1,
    updatedAt: signal.occurredAt,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function rankDocuments(
  rows: readonly (typeof tutorKnowledgeDocuments.$inferSelect)[],
  input: { studentId: string; projectId: string | null; query: string },
): TutorKnowledgeSearchResult[] {
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows
    .filter((row) => row.active)
    .filter((row) => row.scope === 'system' ||
      (row.scope === 'student' && row.studentId === input.studentId) ||
      (row.scope === 'project' && input.projectId !== null && row.projectId === input.projectId))
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
