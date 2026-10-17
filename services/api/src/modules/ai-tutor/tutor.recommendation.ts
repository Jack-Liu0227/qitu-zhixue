import type { ExplorationView } from '@qitu/contracts';
import type { TemplateView } from '../templates/templates.types';

export const RECOMMENDATION_TOP_N = 3;
export const RECOMMENDATION_MAX_EMISSIONS = 3;

export interface ExtractedIntent {
  goalUser: string;
  coreInterests: string[];
}

export function parseExtractedIntent(text: string, sourceMessages: readonly string[]): ExtractedIntent | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'coreInterests,goalUser') return null;
  if (typeof record.goalUser !== 'string' || !Array.isArray(record.coreInterests)) return null;
  const goalUser = record.goalUser.trim();
  if (!goalUser || goalUser.length > 120 || /[\u0000-\u001f]/u.test(goalUser)) return null;
  if (record.coreInterests.length < 1 || record.coreInterests.length > 8) return null;
  const coreInterests: string[] = [];
  for (const raw of record.coreInterests) {
    if (typeof raw !== 'string') return null;
    const interest = raw.trim();
    if (!interest || interest.length > 24 || /[\u0000-\u001f]/u.test(interest)) return null;
    if (!coreInterests.includes(interest)) coreInterests.push(interest);
  }
  const source = sourceMessages.join(' ');
  if (!source.includes(goalUser) || coreInterests.some((interest) => !source.includes(interest))) return null;
  return { goalUser, coreInterests };
}

/** Only accepts an explicit "为 X ...做/设计/制作 Y" statement, verbatim. */
export function extractConservativeIntent(message: string): ExtractedIntent | null {
  if (message.length > 2_000) return null;
  const match = message.match(/为([^，。！？；\n]{1,24}?)(?:设计|制作|开发|建造|创建|做)(?:一个|一款|一份)?([^，。！？；\n]{2,24})/u);
  if (!match) return null;
  const goalUser = match[1]?.trim();
  const interest = match[2]?.trim();
  if (!goalUser || !interest || goalUser.length > 120 || interest.length > 24) return null;
  return { goalUser, coreInterests: [interest] };
}

export interface RecommendationSignals {
  clarified: boolean;
  goal: string;
  interests: string[];
  recentKeywords: string[];
  auditSignals: {
    status: string;
    goalPresent: boolean;
    interests: string[];
    recentMessageCount: number;
  };
}

export interface RecommendationCandidate {
  template: TemplateView;
  score: number;
  reasons: string[];
}

const STOP_WORDS = new Set(['的', '了', '和', '与', '我', '想', '做', '一个', '项目', '希望', '可以', '能够', '怎么', '什么']);

export function buildRecommendationSignals(
  exploration: ExplorationView,
  recentStudentMessages: readonly string[],
): RecommendationSignals {
  const goal = exploration.intentDraft?.goalUser?.trim() ?? '';
  const interests = (exploration.intentDraft?.coreInterests ?? []).map((value) => value.trim()).filter(Boolean);
  const recentKeywords = recentStudentMessages.flatMap(tokenize).slice(0, 24);
  return {
    clarified: exploration.status === 'awaiting_confirmation' && goal.length > 0 && interests.length > 0,
    goal,
    interests,
    recentKeywords,
    auditSignals: {
      status: exploration.status,
      goalPresent: goal.length > 0,
      interests,
      recentMessageCount: recentStudentMessages.length,
    },
  };
}

export function rankTemplateRecommendations(
  signals: RecommendationSignals,
  templates: readonly TemplateView[],
): RecommendationCandidate[] {
  if (!signals.clarified) return [];
  const intentTokens = new Set([...tokenize(signals.goal), ...signals.interests.flatMap(tokenize), ...signals.recentKeywords]);
  return templates
    .filter((template) => template.status === 'published' && template.latestPublishedVersionId !== null)
    .map((template) => scoreTemplate(template, intentTokens, signals))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.template.id.localeCompare(right.template.id))
    .slice(0, RECOMMENDATION_TOP_N);
}

export function parseModelRecommendation(text: string, candidates: readonly RecommendationCandidate[]): string[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { templateIds?: unknown }).templateIds)) return null;
    const ids = (parsed as { templateIds: unknown[] }).templateIds;
    if (ids.length === 0 || ids.some((id) => typeof id !== 'string' || !candidates.some((candidate) => candidate.template.id === id))) return null;
    const unique = [...new Set(ids as string[])];
    return unique.length === ids.length ? unique : null;
  } catch {
    return null;
  }
}

function scoreTemplate(template: TemplateView, intentTokens: Set<string>, signals: RecommendationSignals): RecommendationCandidate {
  const reasons: string[] = [];
  let score = 0;
  const weighted = [
    ['domain', template.domain, 6],
    ['title', template.title, 5],
    ['summary', template.summary, 3],
    ['learningObjectives', template.learningObjectives.join(' '), 4],
    ['outcomeForm', template.outcomeForm, 2],
    ['ageRange', template.ageRange, 1],
    ['difficulty', template.difficulty, 1],
  ] as const;
  for (const [field, value, weight] of weighted) {
    const overlap = tokenize(value ?? '').filter((token) => intentTokens.has(token));
    if (overlap.length > 0) {
      score += weight * Math.min(overlap.length, 3);
      reasons.push(`${field}:${[...new Set(overlap)].slice(0, 3).join('、')}`);
    }
  }
  const duration = template.estimatedDurationMinutes ?? 0;
  if (duration > 0 && /短|快|课内|一周/.test(`${signals.goal}${signals.interests.join('')}`) && duration <= 480) {
    score += 2;
    reasons.push('duration:short-fit');
  }
  if (duration >= 960 && /长期|深入|系统|八周|8周/.test(`${signals.goal}${signals.interests.join('')}`)) {
    score += 2;
    reasons.push('duration:long-fit');
  }
  return { template, score, reasons };
}

function tokenize(value: string | null | undefined): string[] {
  const parts = (value ?? '').toLocaleLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? [];
  return parts.flatMap((part) => {
    if (/^[\p{Script=Han}]+$/u.test(part)) {
      return part.length === 1 ? [part] : Array.from({ length: part.length - 1 }, (_, index) => part.slice(index, index + 2));
    }
    return part.length > 1 ? [part] : [];
  }).filter((part) => !STOP_WORDS.has(part));
}
