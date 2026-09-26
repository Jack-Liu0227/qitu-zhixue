'use client';

import type { ConflictChoice, WorkbenchConflict, WorkbenchContent } from '../types/workbench';

export interface ConflictDialogProps {
  conflict: WorkbenchConflict;
  resolving: boolean;
  onResolve: (choice: ConflictChoice) => void;
}

function summarize(content: WorkbenchContent): string {
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return '（无法显示内容）';
  }
}

/**
 * 409 optimistic-lock recovery. Never silently overwrites or discards: the
 * student explicitly picks 保留我的 / 使用服务器 / 尝试合并.
 *
 * 「尝试合并」is offered ONLY for `kind='flow'`; code/sim/test merges are
 * ambiguous and therefore hidden.
 */
export function ConflictDialog({ conflict, resolving, onResolve }: ConflictDialogProps) {
  return (
    <div className="qitu-conflict-dialog" role="dialog" aria-modal="true" aria-label="草稿冲突">
      <div className="qitu-conflict-card">
        <h2>草稿有冲突</h2>
        <p className="qitu-conflict-lead">
          服务器上的草稿已经更新（当前 revision <strong>{conflict.serverRevision}</strong>），
          你本地也有一份未同步的修改。请选择怎么处理，草稿不会被自动覆盖或丢弃。
        </p>
        <div className="qitu-conflict-columns">
          <section>
            <h3>你的版本</h3>
            <pre className="qitu-conflict-content">{summarize(conflict.localContent)}</pre>
          </section>
          <section>
            <h3>
              服务器版本（revision {conflict.serverRevision}）
              {conflict.serverUpdatedAt ? <span className="qitu-conflict-time">{conflict.serverUpdatedAt}</span> : null}
            </h3>
            <pre className="qitu-conflict-content">{summarize(conflict.serverContent)}</pre>
          </section>
        </div>
        <div className="qitu-conflict-actions">
          <button
            type="button"
            className="qitu-button qitu-button-primary"
            disabled={resolving}
            onClick={() => onResolve('keep-mine')}
          >
            保留我的
          </button>
          <button
            type="button"
            className="qitu-button qitu-button-ghost"
            disabled={resolving}
            onClick={() => onResolve('use-server')}
          >
            使用服务器版本
          </button>
          {conflict.kind === 'flow' ? (
            <button
              type="button"
              className="qitu-button qitu-button-ghost"
              disabled={resolving}
              onClick={() => onResolve('merge')}
            >
              尝试合并
            </button>
          ) : null}
        </div>
        <p className="qitu-conflict-note">
          未采用的那一版会被暂存在本机供你找回。合并只对流程设计提供，且同一节点/连线以服务器版本为准。
        </p>
      </div>
    </div>
  );
}
