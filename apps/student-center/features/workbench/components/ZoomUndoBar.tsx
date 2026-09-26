'use client';

export interface ZoomUndoBarProps {
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  disabled?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function ZoomUndoBar({
  zoom,
  canUndo,
  canRedo,
  disabled = false,
  onZoomIn,
  onZoomOut,
  onUndo,
  onRedo,
}: ZoomUndoBarProps) {
  return (
    <div className="qitu-zoom-undo-bar" aria-label="缩放与撤销">
      <button type="button" onClick={onZoomOut} disabled={disabled} aria-label="缩小">
        −
      </button>
      <span className="qitu-zoom-value">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={onZoomIn} disabled={disabled} aria-label="放大">
        +
      </button>
      <span className="qitu-zoom-sep" aria-hidden="true" />
      <button type="button" onClick={onUndo} disabled={disabled || !canUndo}>
        撤销
      </button>
      <button type="button" onClick={onRedo} disabled={disabled || !canRedo}>
        重做
      </button>
    </div>
  );
}
