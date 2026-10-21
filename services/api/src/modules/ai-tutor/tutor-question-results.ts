import { ForbiddenException } from '@nestjs/common';
import type { CurrentUser, GetTutorSessionResponse, TutorReplyBlock } from '@qitu/contracts';
import type { LearningPlanService } from '../learning-plan/learning-plan.service';
import type { TutorSessionRecord } from './tutor.service';

/** Refresh public results from their owner. Transcript/model fields never authorize answer disclosure. */
export async function restoreQuestionResults(
  actor: CurrentUser,
  record: Pick<TutorSessionRecord, 'sessionId' | 'ownerId' | 'projectId'>,
  response: GetTutorSessionResponse,
  owner: Pick<LearningPlanService, 'readQuestionCandidateResult'>,
): Promise<GetTutorSessionResponse> {
  if (actor.role !== 'student' || actor.id !== record.ownerId || response.sessionId !== record.sessionId || response.projectId !== record.projectId) {
    throw new ForbiddenException('无权读取该对话的作答结果。');
  }
  const results = new Map<string, ReturnType<LearningPlanService['readQuestionCandidateResult']>>();
  const restore = async (block: TutorReplyBlock): Promise<TutorReplyBlock> => {
    if (block.kind !== 'quiz' || (!block.sourceScope && block.assessmentMode !== 'formative')) return block;
    const { answer: _untrustedAnswer, graded: _untrustedGrade, ...publicQuestion } = block;
    const scope = block.sourceScope;
    if (!scope || block.assessmentMode !== 'formative' || scope.projectId !== record.projectId || scope.tutorSessionId !== record.sessionId) {
      throw new ForbiddenException('题目不属于本对话。');
    }
    const cacheKey = JSON.stringify([block.questionId, scope]);
    let reading = results.get(cacheKey);
    if (!reading) {
      reading = owner.readQuestionCandidateResult(actor, scope, block.questionId);
      results.set(cacheKey, reading);
    }
    const answer = await reading;
    return answer === null ? publicQuestion : { ...publicQuestion, answer };
  };
  return { ...response, turns: await Promise.all(response.turns.map(async turn => ({
    ...turn, blocks: await Promise.all(turn.blocks.map(restore)),
  }))) };
}
