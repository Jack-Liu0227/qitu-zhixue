/**
 * Student intake state machine: interest exploration → project recommendation → intent confirmation.
 *
 * FIXED PRODUCT COPY — not model output. The opening turn invites the student to share what they
 * are interested in and states that a project is created only after the student confirms.
 */

import type {
  ConfirmIntentRequest,
  ConfirmIntentResponse,
  ExplorationView,
  TutorTurn,
  UpdateIntentDraftRequest,
} from '@qitu/contracts';
import type { InspirationTemplate } from '../inspiration/types';

export type IntakePhase = 'interest' | 'recommend' | 'confirmed';
export interface IntakeConfirmationSource {
  updateIntentDraft(
    explorationId: string,
    request: UpdateIntentDraftRequest,
    idempotencyKey: string,
  ): Promise<ExplorationView>;
  confirmIntent(
    explorationId: string,
    request: ConfirmIntentRequest,
    idempotencyKey: string,
  ): Promise<ConfirmIntentResponse>;
}

export interface IntakeConfirmationResult {
  state: IntakeState;
  response: ConfirmIntentResponse | null;
  error: unknown | null;
}

/** Persist the draft before confirming; failures deliberately leave recommend phase intact. */
export async function confirmIntake(
  state: IntakeState,
  template: InspirationTemplate,
  studentMessage: string,
  source: IntakeConfirmationSource,
  createKey: () => string,
): Promise<IntakeConfirmationResult> {
  if (state.phase !== 'recommend' || state.explorationId === null) {
    return { state, response: null, error: null };
  }
  const draft: UpdateIntentDraftRequest = {
    coreInterests: template.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    goalUser: studentMessage.trim() || null,
  };
  try {
    await source.updateIntentDraft(state.explorationId, draft, createKey());
    const response = await source.confirmIntent(
      state.explorationId,
      { note: studentMessage.trim() || null },
      createKey(),
    );
    if (typeof response.project?.id !== 'string' || response.project.id.length === 0) {
      return { state, response: null, error: new Error('确认响应缺少项目 id') };
    }
    return { state: advanceToConfirmed(state, template.id), response, error: null };
  } catch (error) {
    return { state, response: null, error };
  }
}


export interface IntakeState {
  phase: IntakePhase;
  recommendedTemplates: InspirationTemplate[];
  confirmedTemplateId: string | null;
  explorationId: string | null;
}

/**
 * FIXED PRODUCT COPY — not model output.
 * The opening turn from 启途智学助手 that appears when the thread has no server turns.
 */
export const INTAKE_OPENING_TURN: TutorTurn = {
  turnId: 'intake-opening',
  role: 'assistant',
  blocks: [
    {
      kind: 'text',
      text: '你好！我是启途智学助手，你的 AI 项目探究伙伴。\n\n我可以帮你把感兴趣的话题，变成一个真实的项目学习旅程。先聊聊你最近对什么感兴趣？比如想做个小游戏、探索某个科学现象，或者学习某项技能。\n\n我们会先一起确认你的想法，推荐合适的项目方向。**只有在你确认之后，系统才会创建正式项目**，然后导师团队会接手，陪你一步步完成。',
    },
  ],
  hintLevel: null,
  stageBefore: null,
  stageAfter: null,
  seq: 0,
  createdAt: new Date().toISOString(),
  modality: 'text',
};

/**
 * FIXED PRODUCT COPY — not model output.
 * The opening turn for a student who already arrived with a direction (deep link
 * from the inspiration detail page). Same guarantee as the intake opening: nothing
 * is created until the student confirms.
 */
export function recommendOpeningTurn(templateTitle: string): TutorTurn {
  return {
    turnId: 'intake-recommend-opening',
    role: 'assistant',
    blocks: [
      {
        kind: 'text',
        text: `你正在看《${templateTitle}》。在我把它变成你的正式项目之前，先说说你想做出什么、或者最想弄明白什么？\n\n我会按你的想法推荐项目方向。**只有你点确认之后，系统才会创建正式项目**，然后导师团队会接手，陪你一步步完成。`,
      },
    ],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq: 0,
    createdAt: new Date().toISOString(),
    modality: 'text',
  };
}

/**
 * Create the initial intake state for a new exploration session.
 */
export function createIntakeState(
  explorationId: string | null,
  deepLinkTemplateId?: string,
): IntakeState {
  if (deepLinkTemplateId !== undefined) {
    // Deep link: pre-populate the recommendation phase with the selected template
    return {
      phase: 'recommend',
      recommendedTemplates: [],
      confirmedTemplateId: null,
      explorationId,
    };
  }
  return {
    phase: 'interest',
    recommendedTemplates: [],
    confirmedTemplateId: null,
    explorationId,
  };
}

/**
 * Advance the intake state machine to the recommendation phase.
 * Called after the student has shared their interest and the server has responded.
 */
export function advanceToRecommend(
  state: IntakeState,
  templates: InspirationTemplate[],
): IntakeState {
  if (state.phase !== 'interest') return state;
  return { ...state, phase: 'recommend', recommendedTemplates: templates };
}

/**
 * Advance the intake state machine to the confirmed phase.
 * Called after the student has confirmed their intent and the server command succeeded.
 */
export function advanceToConfirmed(
  state: IntakeState,
  confirmedTemplateId: string,
): IntakeState {
  if (state.phase !== 'recommend') return state;
  return { ...state, phase: 'confirmed', confirmedTemplateId };
}

/**
 * Check if the intake opening turn should be rendered.
 * Render it when the thread has no server turns (only the local echo, if any).
 */
export function shouldShowIntakeOpening(turns: readonly TutorTurn[]): boolean {
  // Show the opening turn only when there are no server turns yet
  const serverTurns = turns.filter((turn) => turn.role === 'assistant' && !turn.turnId.startsWith('local-echo-'));
  return serverTurns.length === 0;
}
