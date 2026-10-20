import { ConflictException } from '@nestjs/common';
import type { ModelRuntimeTool } from '@qitu/model-runtime';
import type { TutorReplyBlock } from '@qitu/contracts';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';
import { hashRequest } from '../../common/idempotency';
import type { TutorTeachingContext } from './tutor-teaching-context';
import type { ImaReadEvidence } from './ima-project-scope';
import { LESSON_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/lesson-activity.schema';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
export { LESSON_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/lesson-activity.schema';

export const LESSON_ACTIVITY_SKILL = 'pbl-dynamic-lesson';
export const LESSON_ACTIVITY_TOOL = 'tutor.propose_lesson_activity';
// Canonical Admin identity stays dotted; the explicit wire alias is portable across model providers.
export const LESSON_ACTIVITY_FUNCTION = 'tutor_propose_lesson_activity';
export interface LessonQuestionCandidate {
  prompt: string; options: { text: string }[]; correctOptionIndex: number; explanation: string;
  difficulty: 'easy' | 'medium' | 'hard'; sourceRefs: string[];
}
export interface LessonActivityScope {
  projectId: string; planId: string; planRevision: number; learningSessionId: string;
  objectiveId: string; tutorSessionId: string;
}
export interface LessonActivityChannel {
  tools: ModelRuntimeTool[];
  blocks(): TutorReplyBlock[];
  suppressNarration(): boolean;
}
interface Input {
  teaching: TutorTeachingContext;
  runtime: EffectiveAgentRuntime;
  scope: LessonActivityScope;
  idempotencyKey: string;
  pendingQuestion?: Extract<TutorReplyBlock, { kind: 'quiz' }> | null;
  restorePending?: boolean;
  refresh(): Promise<{ teaching: TutorTeachingContext; runtime: EffectiveAgentRuntime }>;
  acceptQuestion(candidate: LessonQuestionCandidate, key: string,
    verify: (refs: readonly string[]) => Promise<readonly ImaReadEvidence[]>): Promise<Extract<TutorReplyBlock, { kind: 'quiz' }>>;
  verifyEvidence(refs: readonly string[]): Promise<readonly ImaReadEvidence[]>;
  proposeOptics(candidate: OpticsCandidate, key: string): Promise<Extract<TutorReplyBlock, { kind: 'optics_experiment' }>>;
}
export interface OpticsCandidate { title: string; summary: string; mode: 'diffraction' | 'scattering'; parameters: Record<string, number> }

function invalid(message = '教学活动候选不符合当前课时协议。'): never {
  throw new ConflictException({ code: 'TUTOR_ACTIVITY_INVALID', message });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[<>]|javascript:|data:|https?:\/\//iu.test(value)) invalid();
  return value.trim();
}
export function isLessonActivityAuthorized(runtime: EffectiveAgentRuntime): boolean {
  return runtime.agent.enabled && runtime.agent.capabilities.includes('teach')
    && runtime.skills.some((skill) => skill.id === LESSON_ACTIVITY_SKILL
      && (skill.publicationStatus === 'published' || skill.publicationStatus === 'reviewed'))
    && runtime.tools.some((tool) => tool.id === LESSON_ACTIVITY_TOOL && tool.version === 'tutor.propose_lesson_activity.v1'
      && tool.inputSchemaDigest === teachingValueDigest(LESSON_ACTIVITY_SCHEMA));
}

export function buildActivityBoard(candidate: Record<string, unknown>, boardId: string): Extract<TutorReplyBlock, { kind: 'board' }> {
  exact(candidate, ['kind', 'title', 'steps']);
  const title = text(candidate.title, 100);
  if (!Array.isArray(candidate.steps) || !candidate.steps.length || candidate.steps.length > 5) invalid();
  const steps = candidate.steps.map((raw) => {
    const step = record(raw); exact(step, ['caption', 'nodes', 'edges', 'tex']);
    const caption = text(step.caption, 300);
    let mermaid: string | undefined;
    let tex: string | undefined;
    if (step.nodes !== undefined) {
      if (!Array.isArray(step.nodes) || !step.nodes.length || step.nodes.length > 12 || !Array.isArray(step.edges) || step.edges.length > 20) invalid();
      const nodes = step.nodes.map((rawNode) => {
        const node = record(rawNode); exact(node, ['id', 'label']);
        const id = text(node.id, 40);
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(id)) invalid();
        return { id, label: text(node.label, 100).replace(/["\[\]{}|;`\\]/gu, ' ') };
      });
      if (new Set(nodes.map((node) => node.id)).size !== nodes.length) invalid();
      const edges = step.edges.map((rawEdge) => {
        const edge = record(rawEdge); exact(edge, ['from', 'to']);
        if (!nodes.some((node) => node.id === edge.from) || !nodes.some((node) => node.id === edge.to)) invalid();
        return `${edge.from} --> ${edge.to}`;
      });
      mermaid = ['flowchart LR', ...nodes.map((node) => `${node.id}["${node.label}"]`), ...edges].join('\n');
    }
    if (step.tex !== undefined) {
      tex = text(step.tex, 500);
      if (/\\(?:href|url|html\w*|includegraphics|def|gdef|edef|newcommand|renewcommand|require|input|write)/iu.test(tex)) invalid();
    }
    if (!mermaid && !tex) invalid();
    return { caption, ...(mermaid ? { mermaid } : {}), ...(tex ? { tex } : {}) };
  });
  return { kind: 'board', boardId, title, steps };
}

/** Exposes candidate creation only when both the reviewed skill and pinned tool survived current authorization. */
export function createLessonActivityChannel(input: Input): LessonActivityChannel {
  const blocks: TutorReplyBlock[] = input.restorePending && input.pendingQuestion ? [input.pendingQuestion] : [];
  let createdQuestion = false;
  let acceptedDigest: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const channel: LessonActivityChannel = { tools: [], blocks: () => [...blocks], suppressNarration: () => createdQuestion };
  if (!isLessonActivityAuthorized(input.runtime)) return channel;
  const scheduledDomain = input.teaching.bundle.template.curriculum?.profiles.find((profile) => profile.id === input.teaching.bundle.scheduleProfileId)
    ?.sessions.find((session) => session.sessionIndex === input.teaching.session.lessonIndex)?.interactiveSpec?.domainTopic ?? 'none';
  channel.tools = [{
    name: LESSON_ACTIVITY_FUNCTION,
    description: `Propose one activity for ${input.teaching.lesson.title}: ${input.teaching.currentTask?.detail ?? ''}. Scheduled interactive domain: ${scheduledDomain}. Board uses nodes/edges or TeX; optics uses the registered lesson model. Choice questions need evidence_ref values returned by successful source reads; they are formative, never a mastery decision.${input.pendingQuestion ? ` A question is already pending; do not create another or reveal its answer. Public question: ${JSON.stringify({ stem: input.pendingQuestion.stem, options: input.pendingQuestion.options })}` : ''}`,
    inputSchema: LESSON_ACTIVITY_SCHEMA,
    execute: (args) => {
      const result = queue.then(async () => {
        const fresh = await input.refresh();
        if (!isLessonActivityAuthorized(fresh.runtime) || fresh.teaching.planId !== input.scope.planId
          || fresh.teaching.planRevision !== input.scope.planRevision || fresh.teaching.session.id !== input.scope.learningSessionId
          || fresh.teaching.objective?.id !== input.scope.objectiveId || fresh.teaching.role.roleSlotId !== input.teaching.role.roleSlotId) {
          invalid('课时、教学配置或权限已变化，请刷新后继续。');
        }
        const candidate = record(args);
        const digest = hashRequest(candidate);
        if (acceptedDigest) {
          if (acceptedDigest !== digest) invalid('本轮已有活动，请先完成当前任务。');
          return { text: 'Activity already accepted. Display the server-owned block; do not disclose any answer key.' };
        }
        const key = `lesson-activity:${input.scope.tutorSessionId}:${input.idempotencyKey}`;
        let block: TutorReplyBlock;
        if (candidate.kind === 'board') block = buildActivityBoard(candidate, `board-${hashRequest({ scope: input.scope, key }).slice(0, 32)}`);
        else if (candidate.kind === 'optics') {
          exact(candidate, ['kind', 'title', 'summary', 'mode', 'parameters']);
          if (candidate.mode !== 'diffraction' && candidate.mode !== 'scattering') invalid();
          block = await input.proposeOptics({ title: text(candidate.title, 100), summary: text(candidate.summary, 500),
            mode: candidate.mode, parameters: record(candidate.parameters) as Record<string, number> }, key);
        } else if (candidate.kind === 'choice_question') {
          if (input.pendingQuestion) invalid('当前问题尚未完成，请继续当前问题。');
          exact(candidate, ['kind', 'question']);
          block = await input.acceptQuestion(record(candidate.question) as unknown as LessonQuestionCandidate, key, input.verifyEvidence);
        } else invalid();
        blocks.push(block); acceptedDigest = digest;
        if (block.kind === 'quiz') createdQuestion = true;
        return { text: 'Activity accepted by the server. The student will receive its public block. Never repeat the private answer or explanation in chat.' };
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  }];
  return channel;
}
