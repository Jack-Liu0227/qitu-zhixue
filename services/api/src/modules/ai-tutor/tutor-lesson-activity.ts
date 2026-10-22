import { ConflictException } from '@nestjs/common';
import type { ModelRuntimeTool } from '@qitu/model-runtime';
import { serializeTutorLessonProgram } from '@qitu/ai-client';
import { projectTutorLessonProgram } from './tutor-lesson-program';
import type { TutorReplyBlock, OpticsExperimentMode } from '@qitu/contracts';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';
import { hashRequest } from '../../common/idempotency';
import type { TutorTeachingContext } from './tutor-teaching-context';
import type { ImaReadEvidence } from './ima-project-scope';
import { LESSON_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/lesson-activity.schema';
import { WAVE_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/wave-activity.schema';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import { resolveActivitySources } from './tutor-activity-resources';
import { buildWavePreview } from './tutor-wave-preview';
export { LESSON_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/lesson-activity.schema';

export const LESSON_ACTIVITY_SKILL = 'pbl-dynamic-lesson';
export const LESSON_ACTIVITY_TOOL = 'tutor.propose_lesson_activity';
// Canonical Admin identity stays dotted; the explicit wire alias is portable across model providers.
export const LESSON_ACTIVITY_FUNCTION = 'tutor_propose_lesson_activity';
export const WAVE_ACTIVITY_TOOL = 'tutor.propose_wave_activity';
export interface LessonQuestionCandidate {
  prompt: string; options: { text: string }[]; correctOptionIndex: number; explanation: string;
  difficulty: 'easy' | 'medium' | 'hard'; sourceRefs: string[];
}
export interface LessonActivityScope {
  projectId: string; planId: string; planRevision: number; learningSessionId: string;
  objectiveId: string; tutorSessionId: string;
  activityId?: string;
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
  assessmentPending?: boolean;
  refresh(): Promise<{ teaching: TutorTeachingContext; runtime: EffectiveAgentRuntime }>;
  acceptQuestion?(candidate: LessonQuestionCandidate, key: string,
    verify: (refs: readonly string[]) => Promise<readonly ImaReadEvidence[]>): Promise<Extract<TutorReplyBlock, { kind: 'quiz' }>>;
  verifyEvidence(refs: readonly string[]): Promise<readonly ImaReadEvidence[]>;
  proposeOptics(candidate: OpticsCandidate, key: string): Promise<Extract<TutorReplyBlock, { kind: 'optics_experiment' }>>;
}
export interface OpticsCandidate { title: string; summary: string; mode: OpticsExperimentMode; parameters: Record<string, number> }

function invalid(message = '教学活动候选不符合当前课时协议。'): never {
  throw new ConflictException({ code: 'TUTOR_ACTIVITY_INVALID', message });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid(`Only these fields are allowed: ${keys.join(', ')}.`);
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

export function isWaveActivityAuthorized(runtime: EffectiveAgentRuntime): boolean {
  return isLessonActivityAuthorized(runtime) && runtime.tools.some(tool => tool.id === WAVE_ACTIVITY_TOOL
    && tool.version === 'tutor.propose_wave_activity.v1' && tool.inputSchemaDigest === teachingValueDigest(WAVE_ACTIVITY_SCHEMA));
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
  const waveProtocol = input.teaching.bundle.template.curriculum?.profiles.find(profile => profile.id === input.teaching.bundle.scheduleProfileId)
    ?.sessions.find(session => session.sessionIndex === input.teaching.session.lessonIndex)?.requiredToolIds?.includes(WAVE_ACTIVITY_TOOL) === true;
  if (waveProtocol && !isWaveActivityAuthorized(input.runtime)) invalid('本课的波动教学工具未获授权或已撤销。');
  channel.tools = [{
    // The wire alias stays compatible with reviewed skill instructions; the frozen capability selects its schema and owner checks.
    name: LESSON_ACTIVITY_FUNCTION,
    description: `Frozen lesson program: ${serializeTutorLessonProgram(projectTutorLessonProgram(input.teaching))}. Scheduled interactive domain: ${scheduledDomain}. Follow this lesson's activities and evidence requirements. Board uses nodes/edges or TeX; optics uses the registered lesson model. ${waveProtocol ? 'For conceptual observation before the gate, wave_preview generates only read-only registered wave diagrams; no parameters, actions or saved experimental evidence. Choose resources according to current student evidence: recommendation needs actual read evidence_ref sourceRefs; an adapted board needs origin adapted plus sourceRefs; a new board uses origin generated and no sources. Never invent a citation or link. Unavailable knowledge must be stated as unverified. Double slit mode is interference; start with wavelength 550 nm, slitWidth 20 micrometres, slitSeparation 150 micrometres, screenDistance 2 m. Only one variable per comparison. Aperture extent squared divided by wavelength times screen distance must be <=0.1 for the far-field approximation. ' : ''}Choice questions need verified evidence_ref values and an assessment objective; they are formative, never a mastery decision.${input.pendingQuestion ? ` A question is already pending; do not create another or reveal its answer. Public question: ${JSON.stringify({ stem: input.pendingQuestion.stem, options: input.pendingQuestion.options })}` : ''}`,
    inputSchema: waveProtocol ? WAVE_ACTIVITY_SCHEMA : LESSON_ACTIVITY_SCHEMA,
    execute: (args) => {
      const result = queue.then(async () => {
        const fresh = await input.refresh();
        if (!isLessonActivityAuthorized(fresh.runtime) || waveProtocol && !isWaveActivityAuthorized(fresh.runtime) || fresh.teaching.planId !== input.scope.planId
          || fresh.teaching.planRevision !== input.scope.planRevision || fresh.teaching.session.id !== input.scope.learningSessionId
          || fresh.teaching.objective?.id !== input.scope.objectiveId || fresh.teaching.role.roleSlotId !== input.teaching.role.roleSlotId) {
          invalid('课时、教学配置或权限已变化，请刷新后继续。');
        }
        const candidate = record(args);
        const activity = fresh.teaching.lesson.currentActivity;
        if (fresh.teaching.bundle.template.lessonPolicy === 'lesson-guided.v1') {
          if (!activity || activity.activityId !== input.teaching.lesson.currentActivity?.activityId) invalid('当前活动已完成或变化，请刷新课时。');
          if (candidate.kind === 'choice_question' && activity.kind !== 'check') return { isError: true, text: 'CHOICE_QUESTION_ONLY_IN_CHECK. The current activity is for explanation/exploration. Propose a conceptual board (kind=\'board\') instead of a quiz.' };
          if (candidate.kind === 'optics' && activity.kind !== 'practice') return { isError: true, text: 'OPTICS_SIMULATION_PRACTICE_GATED. Quantitative optics simulation is restricted to practice activities after TheoryMastered. For current concept/explore activities, propose a conceptual board (kind=\'board\') with visual diagrams and steps instead.' };
        }
        // Arbitrary board/formula text must not become a second answer-disclosure channel.
        if (input.assessmentPending || input.pendingQuestion) {
          return { isError: true, text: 'PENDING_ASSESSMENT. Keep the existing question. Give a bounded textual hint; do not generate boards, experiments, replacement questions or answer keys.' };
        }
        const digest = hashRequest(candidate);
        if (acceptedDigest) {
          if (acceptedDigest !== digest) invalid('本轮已有活动，请先完成当前任务。');
          return { text: 'Activity already accepted. Display the server-owned block; do not disclose any answer key.' };
        }
        const key = `lesson-activity:${input.scope.tutorSessionId}:${input.idempotencyKey}`;
        let block: TutorReplyBlock;
        if (candidate.kind === 'board') {
          try {
            if (waveProtocol) {
              exact(candidate, ['kind', 'title', 'steps', 'origin', 'sourceRefs']);
              if (candidate.origin !== undefined && candidate.origin !== 'generated' && candidate.origin !== 'adapted') invalid();
              const origin = candidate.origin ?? 'generated';
              if (origin === 'generated' && candidate.sourceRefs !== undefined) invalid('引用资料时请选择改编，并先核验资料。');
              const sources = origin === 'adapted' ? await resolveActivitySources(candidate.sourceRefs, input.verifyEvidence) : [];
              block = { ...buildActivityBoard({ kind: 'board', title: candidate.title, steps: candidate.steps },
                `board-${hashRequest({ scope: input.scope, key }).slice(0, 32)}`), provenance: { origin, sources } };
            } else block = buildActivityBoard(candidate, `board-${hashRequest({ scope: input.scope, key }).slice(0, 32)}`);
          } catch (error) {
            // The runtime hides arbitrary exceptions. Give the model a bounded
            // protocol correction so an invalid candidate can be repaired.
            if (!(error instanceof ConflictException)) throw error;
            const detail = error.getResponse();
            if (typeof detail === 'object' && detail !== null && 'code' in detail
              && ['TUTOR_RESOURCE_INVALID', 'TUTOR_RESOURCE_UNVERIFIED', 'TUTOR_ACTIVITY_UNAVAILABLE'].includes(String(detail.code))) {
              return { isError: true, text: `${detail.code}. Read an authorized source in this turn and copy its exact evidence_ref into sourceRefs. Do not claim it was adapted or verified until accepted.` };
            }
            return { isError: true, text: 'BOARD_CANDIDATE_INVALID. Nothing was accepted. Retry with only kind, title and steps. '
              + (waveProtocol ? 'For an adapted board also include origin=adapted and sourceRefs from actual read evidence_ref values; for a new board use origin=generated and omit sourceRefs. ' : '')
              + 'Each step needs a nonempty caption and either nodes with edges (use [] when no edges), or nonempty tex. '
              + 'Omit unused fields; never send null or empty tex. Node IDs must match [a-zA-Z][a-zA-Z0-9_]*; '
              + 'edges must reference those IDs. Do not include summary, mode, parameters, question, raw Mermaid or executable content.' };
          }
        }
        else if (candidate.kind === 'wave_preview') {
          if (!waveProtocol) invalid();
          exact(candidate, ['kind', 'title', 'summary']);
          block = buildWavePreview(`preview-${hashRequest({ scope: input.scope, key }).slice(0, 32)}`, text(candidate.title, 100),
            candidate.summary === undefined ? '先描述你观察到的图样，不急着解释。' : text(candidate.summary, 300));
        }
        else if (candidate.kind === 'recommendation') {
          if (!waveProtocol) invalid();
          try {
            exact(candidate, ['kind', 'title', 'summary', 'sourceRefs']);
            const sources = await resolveActivitySources(candidate.sourceRefs, input.verifyEvidence);
            block = { kind: 'learning_resource', title: text(candidate.title, 100), summary: text(candidate.summary, 500), sources };
          } catch (error) {
            if (!(error instanceof ConflictException)) throw error;
            const detail = error.getResponse();
            const code = typeof detail === 'object' && detail !== null && 'code' in detail ? String(detail.code) : 'TUTOR_ACTIVITY_INVALID';
            return { isError: true, text: `${code}. Nothing was accepted. Recommendation requires exactly kind, title (1-100 chars), summary (1-500 chars), sourceRefs (exact evidence_ref from an authorized read this turn). Omit origin, steps, links, nulls and unused fields.` };
          }
        }
        else if (candidate.kind === 'optics') {
          exact(candidate, ['kind', 'title', 'summary', 'mode', 'parameters']);
          if (candidate.mode !== 'diffraction' && candidate.mode !== 'scattering' && candidate.mode !== 'interference') invalid();
          if (waveProtocol ? candidate.mode === 'scattering' : candidate.mode === 'interference') invalid();
          block = await input.proposeOptics({ title: text(candidate.title, 100), summary: text(candidate.summary, 500),
            mode: candidate.mode, parameters: record(candidate.parameters) as Record<string, number> }, key);
        } else if (candidate.kind === 'choice_question') {
          if (!input.acceptQuestion) invalid('当前目标用于观察或反思，不进入题目判定范围。');
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
