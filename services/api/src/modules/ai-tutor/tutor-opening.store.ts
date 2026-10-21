import type { TutorProjectContext } from '@qitu/contracts';
import type { TutorSessionSnapshot, TutorTurnRecord } from './tutor-session.store';
import { TutorSessionStore } from './tutor-session.store';
import { buildExplorationOpeningBlocks, buildProjectOpeningBlocks } from './tutor-opening';

export async function persistTutorOpening(store: TutorSessionStore, snapshot: TutorSessionSnapshot,
  context: TutorProjectContext, promptVersion: string): Promise<TutorSessionSnapshot> {
  if (snapshot.turns.length || !context.team) return snapshot;
  const blocks = context.project ? buildProjectOpeningBlocks(context) : buildExplorationOpeningBlocks(context);
  if (!blocks.length) return snapshot;
  const stage = context.project?.stage ?? 'exploration';
  const turn: TutorTurnRecord = {
    turnId: `${snapshot.sessionId}:assistant:1`, role: 'assistant', seq: 1, createdAt: new Date().toISOString(),
    stageBefore: stage, stageAfter: stage, pedagogicMove: 'hint', hintLevel: 1,
    expectedEvidence: '说说你的兴趣、观察或想探究的问题', promptVersion, evidenceRef: null, modality: 'text',
    author: { id: context.team.assistantId, name: context.team.assistantName, role: context.project ? 'leader' : '探索导师',
      ...(context.team.assistantAvatar ? { avatar: context.team.assistantAvatar } : {}) }, blocks,
  };
  try {
    await store.appendTurns({ sessionId: snapshot.sessionId, expectedLastSeq: 0, newLastSeq: 1, turns: [turn] });
    return { ...snapshot, lastSeq: 1, turns: [turn] };
  } catch (error) {
    const latest = await store.findById(snapshot.sessionId);
    if (latest?.ownerId === snapshot.ownerId && latest.turns.length) return latest;
    throw error;
  }
}
