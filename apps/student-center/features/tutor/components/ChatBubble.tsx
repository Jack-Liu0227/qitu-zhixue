import { Avatar } from '@qitu/ui';
import type { TutorReplyBlock, TutorToolCall, TutorTurn } from '@qitu/contracts';

import { isTutorReplyBlock, isTutorToolCall } from '../state';
import { SafeReplyFallback, TutorReplyBlockView } from './TutorReplyBlockView';
import { StreamCaret, ToolCallTimeline } from './ToolCallTimeline';

/**
 * A render segment: either a RUN of consecutive tool calls (collapsed into one
 * 「执行过程」 panel) or a single validated reply block.
 */
type Segment = { kind: 'tools'; calls: TutorToolCall[] } | { kind: 'block'; raw: unknown };

/**
 * One conversation turn. The assistant side consumes only structured
 * `TutorReplyBlock`s — see `TutorReplyBlockView` for why raw markdown is not a
 * renderable format. Any unmodelled runtime block becomes `SafeReplyFallback`.
 *
 * Consecutive `tool` blocks are grouped so a turn like
 * `tool, tool, tool, delta-text, tool` renders as
 * [执行过程: 3 steps] [text] [执行过程: 1 step] — the same order the server
 * executed them, without four separate cards.
 *
 * `streaming` adds the "still being written" caret; it changes presentation
 * only and never the content.
 */
export function ChatBubble({
  turn,
  onSelectOption,
  onCitationClick,
  disabled = false,
  streaming = false,
}: {
  turn: TutorTurn;
  onSelectOption?: (label: string, text?: string) => void;
  onCitationClick?: (index: number) => void;
  disabled?: boolean;
  streaming?: boolean;
}) {
  const isStudent = turn.role === 'student';
  const segments = segmentBlocks(toUnknownBlocks(turn));
  const lastRaw = toUnknownBlocks(turn).at(-1);
  const showCaret = streaming && !isStudent && lastRaw !== undefined && isTextBlock(lastRaw);

  return (
    <div className={isStudent ? 'qitu-chat-bubble is-student' : 'qitu-chat-bubble is-assistant'}>
      <div className="qitu-chat-role">
        <Avatar name={isStudent ? '我' : '启'} size="sm" />
        <span>{isStudent ? '我' : 'AI搭档'}</span>
      </div>
      <div className="qitu-chat-body">
        {segments.map((segment, index) =>
          segment.kind === 'tools' ? (
            <ToolCallTimeline key={`${turn.turnId}-tools-${index}`} calls={segment.calls} />
          ) : isTutorReplyBlock(segment.raw) ? (
            <TutorReplyBlockView
              key={`${turn.turnId}-${index}`}
              block={segment.raw}
              onSelectOption={onSelectOption}
              onCitationClick={onCitationClick}
              disabled={disabled}
            />
          ) : (
            <SafeReplyFallback key={`${turn.turnId}-${index}`} />
          ),
        )}
        {showCaret ? <StreamCaret /> : null}
      </div>
    </div>
  );
}

function segmentBlocks(rawBlocks: readonly unknown[]): Segment[] {
  const segments: Segment[] = [];
  let runOfTools: TutorToolCall[] | null = null;

  const flush = () => {
    if (runOfTools !== null && runOfTools.length > 0) {
      segments.push({ kind: 'tools', calls: runOfTools });
    }
    runOfTools = null;
  };

  for (const raw of rawBlocks) {
    if (isToolBlock(raw)) {
      runOfTools ??= [];
      runOfTools.push(raw.call);
      continue;
    }
    flush();
    segments.push({ kind: 'block', raw });
  }
  flush();
  return segments;
}

function isToolBlock(value: unknown): value is Extract<TutorReplyBlock, { kind: 'tool' }> {
  if (typeof value !== 'object' || value === null) return false;
  if ((value as { kind?: unknown }).kind !== 'tool') return false;
  return isTutorToolCall((value as { call?: unknown }).call);
}

function isTextBlock(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'text'
  );
}

/**
 * Re-validate at the render boundary. `turn.blocks` is typed, but a buggy or
 * hostile transport could still deliver an unmodelled shape, so we hand the
 * runtime guard a widened view rather than trusting the type alone.
 */
function toUnknownBlocks(turn: TutorTurn): unknown[] {
  return turn.blocks as unknown[];
}
