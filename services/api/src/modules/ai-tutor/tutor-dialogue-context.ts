import type { TutorReplyBlock, TutorTurn } from '@qitu/contracts';

/** Replay only public dialogue, never tool results, grading keys or permission claims. */
export function recentTutorDialogue(turns: readonly Pick<TutorTurn, 'role' | 'blocks'>[]) {
  return turns.slice(-6).flatMap(turn => {
    const content = turn.blocks.map(block => publicText(block, turn.role)).filter(Boolean).join('\n').slice(0, 1200);
    return content ? [{ role: turn.role === 'student' ? 'user' as const : 'assistant' as const, content }] : [];
  });
}

function publicText(block: TutorReplyBlock, role: TutorTurn['role']): string {
  if (block.kind === 'text') return block.text;
  if (role !== 'assistant') return '';
  if (block.kind === 'hint') return block.text;
  if (block.kind === 'questions') return block.items.join('\n');
  if (block.kind === 'quiz') return [block.stem, ...block.options.map(option => `${option.key}: ${option.text}`)].join('\n');
  if (block.kind === 'board') return [block.title, ...block.steps.map(step => step.caption)].filter(Boolean).join('\n');
  return '';
}
