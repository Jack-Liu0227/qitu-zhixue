import type { PedagogicMove } from '@qitu/contracts';

/**
 * Module-local capability tile (the shared `CapabilityTile` is not exported by
 * `@qitu/ui` yet). Its click payload is exactly one `pedagogic_move`; the
 * client sends intent and the server records the final move.
 */
export function CapabilityTile({
  move,
  label,
  description,
  levelNote,
  levelPreview,
  disabled,
  disabledReason,
  pending,
  onInvoke,
}: {
  move: PedagogicMove;
  label: string;
  description: string;
  levelNote: string;
  /** Client-side preview of the ladder step this entry would take next. */
  levelPreview?: string;
  disabled: boolean;
  disabledReason?: string;
  pending: boolean;
  onInvoke: (move: PedagogicMove) => void;
}) {
  return (
    <button
      type="button"
      className="qitu-capability-tile"
      data-move={move}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled && disabledReason ? disabledReason : undefined}
      onClick={() => onInvoke(move)}
    >
      <span className="qitu-capability-icon" aria-hidden="true">{iconFor(move)}</span>
      <span className="qitu-capability-copy">
        <span className="qitu-capability-label">{label}</span>
        <span className="qitu-capability-desc">{description}</span>
        <span className="qitu-capability-level">
          {pending ? '发送中…' : levelPreview ?? `提示等级 ${levelNote}`}
        </span>
      </span>
      <span className="qitu-capability-chevron" aria-hidden="true">›</span>
    </button>
  );
}

function iconFor(move: PedagogicMove): string {
  const icons: Record<PedagogicMove, string> = {
    hint: '?',
    scaffold: '≡',
    explain: 'i',
    review_work: '✓',
    debug_guide: '⌕',
    stall_signal: '!',
  };
  return icons[move];
}
