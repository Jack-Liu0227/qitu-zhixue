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
      <span className="qitu-capability-label">{label}</span>
      <span className="qitu-capability-desc">{description}</span>
      <span className="qitu-capability-level">
        {pending ? '发送中…' : levelPreview ?? `提示等级 ${levelNote}`}
      </span>
    </button>
  );
}
