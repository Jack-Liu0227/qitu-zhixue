import { BadRequestException, ConflictException } from '@nestjs/common';
import type { TutorQuestionSourceScope, TutorReplyBlock } from '@qitu/contracts';
import { normalizeAnswer } from '@qitu/ai-client';
import type { PendingQuestionRecord, PlanBundle, SessionRecord } from './learning-plan.store';
import type { VerifiedQuestionSource } from './question-candidate.sources';
export type QuestionCandidateScope = TutorQuestionSourceScope;
export interface ChoiceQuestionCandidate {
  prompt: string;
  options: { text: string }[];
  correctOptionIndex: number;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sourceRefs: string[];
}
export interface DynamicQuestionEnvelope {
  schemaVersion: 'qitu.dynamic-choice.v1';
  kind: 'formative_choice';
  sourceScope: QuestionCandidateScope;
  correctOptionId: string;
  candidateDigest: string;
  sources: VerifiedQuestionSource[];
}
function invalid(): never {
  throw new BadRequestException({ code: 'QUESTION_CANDIDATE_INVALID', message: '动态选择题候选字段、选项或解析不完整。' });
}
function bounded(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid();
  return value.trim();
}
export function parseChoiceQuestionCandidate(raw: unknown): ChoiceQuestionCandidate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['prompt', 'options', 'correctOptionIndex', 'explanation', 'difficulty', 'sourceRefs'].includes(key))) invalid();
  if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 6 || !Number.isSafeInteger(value.correctOptionIndex) ||
    (value.correctOptionIndex as number) < 0 || (value.correctOptionIndex as number) >= value.options.length || !['easy', 'medium', 'hard'].includes(String(value.difficulty))) invalid();
  const options = (value.options as unknown[]).map(option => {
    if (!option || typeof option !== 'object' || Array.isArray(option) || Object.keys(option).some(key => key !== 'text')) return invalid();
    return { text: bounded((option as Record<string, unknown>).text, 1200) };
  });
  if (options.some(option => !normalizeAnswer(option.text)) || new Set(options.map(option => normalizeAnswer(option.text))).size !== options.length) invalid();
  if (!Array.isArray(value.sourceRefs) || !value.sourceRefs.length || value.sourceRefs.length > 8) invalid();
  const sourceRefs = (value.sourceRefs as unknown[]).map(ref => bounded(ref, 160));
  if (new Set(sourceRefs).size !== sourceRefs.length) invalid();
  return { prompt: bounded(value.prompt, 4000), options, correctOptionIndex: value.correctOptionIndex as number,
    explanation: bounded(value.explanation, 8000), difficulty: value.difficulty as ChoiceQuestionCandidate['difficulty'], sourceRefs };
}
export function assertQuestionScope(scope: QuestionCandidateScope, bundle: PlanBundle, session: SessionRecord) {
  if (!scope || !['projectId', 'planId', 'learningSessionId', 'objectiveId', 'tutorSessionId'].every(key => typeof scope[key as keyof QuestionCandidateScope] === 'string' && String(scope[key as keyof QuestionCandidateScope]).trim().length > 0 && String(scope[key as keyof QuestionCandidateScope]).length <= 200) || !Number.isSafeInteger(scope.planRevision) ||
    scope.planRevision < 1 || scope.planRevision !== bundle.plan.version || scope.planId !== bundle.plan.id ||
    scope.projectId !== bundle.plan.projectId || scope.learningSessionId !== session.id ||
    ![...session.theoryObjectiveIds, ...session.practiceObjectiveIds].includes(scope.objectiveId) ||
    !bundle.objectives.some(objective => objective.id === scope.objectiveId && objective.planId === bundle.plan.id)) {
    throw new ConflictException({ code: 'QUESTION_SCOPE_MISMATCH', message: '题目不属于当前项目、课时目标或计划版本。' });
  }
}
export function dynamicQuestionEnvelope(record: PendingQuestionRecord): DynamicQuestionEnvelope {
  let value: DynamicQuestionEnvelope;
  try { value = JSON.parse(record.expectedAnswer) as DynamicQuestionEnvelope; } catch { return invalid(); }
  if (record.assessmentType !== 'formative' || !value || value.schemaVersion !== 'qitu.dynamic-choice.v1' || value.kind !== 'formative_choice' ||
    !value.sourceScope || typeof value.sourceScope.projectId !== 'string' || typeof value.sourceScope.tutorSessionId !== 'string' ||
    !Number.isSafeInteger(value.sourceScope.planRevision) || value.sourceScope.planRevision < 1 ||
    !Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > 8 ||
    value.sources.some(source => !source || typeof source.sourceRef !== 'string' || typeof source.knowledgeBaseId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(source.documentRefHash) || !Number.isSafeInteger(source.expiresAt)) ||
    !/^[a-f0-9]{64}$/.test(value.candidateDigest) ||
    !record.options.some(option => option.id === value.correctOptionId) || value.sourceScope.planId !== record.planId ||
    value.sourceScope.learningSessionId !== record.sessionId || value.sourceScope.objectiveId !== record.objectiveId) return invalid();
  return value;
}
export function dynamicQuestionBlock(record: PendingQuestionRecord): Extract<TutorReplyBlock, { kind: 'quiz' }> {
  const envelope = dynamicQuestionEnvelope(record);
  return { kind: 'quiz', questionId: record.id, stem: record.prompt, type: 'single',
    options: record.options.map(option => ({ key: option.id, text: option.body })), sourceScope: envelope.sourceScope,
    assessmentMode: 'formative', sourceRefs: envelope.sources.map(source => source.sourceRef), rationaleHint: '作答后查看解析；此题用于巩固，不直接认定掌握。' };
}
