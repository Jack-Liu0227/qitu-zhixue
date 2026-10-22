import type { TutorProjectContext } from '@qitu/contracts';
import type { TutorSessionSnapshot, TutorTurnRecord } from './tutor-session.store';
import { TutorSessionStore } from './tutor-session.store';
import { buildExplorationOpeningBlocks, buildProjectOpeningBlocks } from './tutor-opening';

export async function persistTutorOpening(store: TutorSessionStore, snapshot: TutorSessionSnapshot,
  context: TutorProjectContext, promptVersion: string): Promise<TutorSessionSnapshot> {
  if (!context.team) return snapshot;
  const lesson = context.lesson;
  const lessonOpening = Boolean(context.project && lesson?.opening && lesson.planId && lesson.planRevision && lesson.learningSessionId);
  if (snapshot.turns.length && !lessonOpening) return snapshot;
  if (lessonOpening && snapshot.turns.some(turn => turn.blocks.some(block => block.kind === 'learning_opening' && block.mode === 'lesson'
    && block.scope.planId === lesson!.planId && block.scope.planRevision === lesson!.planRevision
    && block.scope.learningSessionId === lesson!.learningSessionId))) return snapshot;
  const blocks = context.project ? buildProjectOpeningBlocks(context) : buildExplorationOpeningBlocks(context);
  if (!blocks.length) return snapshot;
  const stage = context.project?.stage ?? 'exploration';
  const seq = snapshot.lastSeq + 1;
  const turn: TutorTurnRecord = {
    turnId: `${snapshot.sessionId}:assistant:${seq}`, role: 'assistant', seq, createdAt: new Date().toISOString(),
    stageBefore: stage, stageAfter: stage, pedagogicMove: 'hint', hintLevel: 1,
    expectedEvidence: '说说你的兴趣、观察或想探究的问题', promptVersion, evidenceRef: null, modality: 'text',
    author: { id: context.team.assistantId, name: context.team.assistantName, role: context.project ? '课时导师' : '探索导师',
      ...(context.team.assistantAvatar ? { avatar: context.team.assistantAvatar } : {}) }, blocks,
  };
  try {
    await store.appendTurns({ sessionId: snapshot.sessionId, expectedLastSeq: snapshot.lastSeq, newLastSeq: seq, turns: [turn] });
    return { ...snapshot, lastSeq: seq, turns: [...snapshot.turns, turn] };
  } catch (error) {
    const latest = await store.findById(snapshot.sessionId);
    if (latest?.ownerId === snapshot.ownerId && latest.turns.length) return latest;
    throw error;
  }
}
