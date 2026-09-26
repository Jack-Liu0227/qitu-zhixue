'use client';

export interface WorkbenchActionBarProps {
  previewing: boolean;
  saving: boolean;
  finishing: boolean;
  disabled: boolean;
  previewDisabled?: boolean;
  previewUrl: string | null;
  onPreview: () => void;
  onSnapshot: () => void;
  onFinish: () => void;
}

/**
 * Bottom actions: 预览效果 / 保存成果 / 完成后进入作品展厅.
 * Publishing itself belongs to the `works` module; this button only signals
 * intent (Wave 4 wires the destination).
 */
export function WorkbenchActionBar({
  previewing,
  saving,
  finishing,
  disabled,
  previewDisabled = false,
  previewUrl,
  onPreview,
  onSnapshot,
  onFinish,
}: WorkbenchActionBarProps) {
  return (
    <div className="qitu-workbench-actions">
      <button
        type="button"
        className="qitu-button qitu-button-ghost"
        onClick={onPreview}
        disabled={disabled || previewDisabled || previewing}
      >
        {previewing ? '预览生成中…' : '预览效果'}
      </button>
      <button type="button" className="qitu-button qitu-button-ghost" onClick={onSnapshot} disabled={disabled || saving}>
        {saving ? '保存中…' : '保存成果'}
      </button>
      <button type="button" className="qitu-button qitu-button-primary" onClick={onFinish} disabled={disabled || finishing}>
        {finishing ? '正在前往…' : '完成后进入作品展厅'}
      </button>
      {previewUrl ? (
        <a className="qitu-workbench-preview-link" href={previewUrl} target="_blank" rel="noreferrer">
          打开预览
        </a>
      ) : null}
    </div>
  );
}
