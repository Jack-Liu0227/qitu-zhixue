import type { PedagogicMove, TutorHintLevel } from '@qitu/contracts';
import { HandwrittenNote, SectionCard } from '@qitu/ui';
import {
  CAPABILITY_ENTRIES,
  CONTINUOUS_GUIDANCE_CAP,
  type CapabilityKind,
  canRequestGuidance,
  nextHintLevel,
} from '../pedagogy';
import { CapabilityTile } from './CapabilityTile';

/**
 * Moves gated once the continuous-guidance run reaches `CONTINUOUS_GUIDANCE_CAP`:
 * `hint` and `debug_guide` (kind 'guidance') plus `scaffold` (kind 'scaffold').
 * The spec caps all three; anything else (explain/review/stall) stays available.
 */
const GUIDANCE_CAPPED_KINDS: readonly CapabilityKind[] = ['guidance', 'scaffold'];

function isCappedByGuidanceRun(kind: CapabilityKind): boolean {
  return GUIDANCE_CAPPED_KINDS.includes(kind);
}

/**
 * RIGHT COLUMN — 「我可以这样帮你」 six capability entries.
 *
 * The entries map 1:1 to the six `pedagogic_move` values (see
 * `CAPABILITY_ENTRIES`). The rail only sends intent; it never writes a move
 * result, a hint level or an escalation state.
 *
 * Guidance entries (`hint` / `debug_guide`) and the `scaffold` move are disabled
 * once the continuous guidance run reaches `CONTINUOUS_GUIDANCE_CAP`; at that
 * point the student should switch question or use 「我卡住了」 so the server can
 * escalate.
 */
export function CapabilityRail({
  sessionReady,
  lastHintLevel,
  guidanceRun,
  pendingMove,
  onInvoke,
}: {
  sessionReady: boolean;
  lastHintLevel: TutorHintLevel | null;
  guidanceRun: number;
  pendingMove: PedagogicMove | null;
  onInvoke: (move: PedagogicMove) => void;
}) {
  const guidanceCapReached = !canRequestGuidance(guidanceRun);

  return (
    <aside className="qitu-tutor-col qitu-tutor-col-right">
      <SectionCard title="我可以这样帮你">
        <div className="qitu-capability-rail">
          {CAPABILITY_ENTRIES.map((entry) => {
            const nextLevel = nextHintLevel(lastHintLevel, entry.move);
            const cappedByGuidanceRun = guidanceCapReached && isCappedByGuidanceRun(entry.kind);
            const disabled = !sessionReady || pendingMove !== null || cappedByGuidanceRun;
            const disabledReason = !sessionReady
              ? '先开始一个项目才能使用'
              : cappedByGuidanceRun
                ? `这道题已经连续引导 ${CONTINUOUS_GUIDANCE_CAP} 轮了，换一个问题或点「我卡住了」`
                : undefined;
            const levelPreview =
              nextLevel !== null && entry.kind !== 'review' && entry.kind !== 'stall'
                ? `下一次到第 ${nextLevel} 档（默认 1 起，每轮最多升 1 档）`
                : undefined;
            return (
              <CapabilityTile
                key={entry.move}
                move={entry.move}
                label={entry.label}
                description={entry.description}
                levelNote={entry.levelNote}
                levelPreview={levelPreview}
                disabled={disabled}
                disabledReason={disabledReason}
                pending={pendingMove === entry.move}
                onInvoke={onInvoke}
              />
            );
          })}
        </div>
      </SectionCard>
      <div className="qitu-tutor-encouragement">
        <HandwrittenNote>每一次卡住，都是在长出新的思路。</HandwrittenNote>
      </div>
    </aside>
  );
}
