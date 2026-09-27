'use client';

import type { FlowNodeType } from '../types/workbench';

/**
 * Narrow palette contract. The palette internals are deferred with the
 * interactive canvas; this is the interface the eventual palette must satisfy.
 */
export interface NodePaletteProps {
  nodeTypes: FlowNodeType[];
  disabled: boolean;
  onAddNode: (type: FlowNodeType) => void;
}

const LABELS: Record<FlowNodeType, string> = {
  start: '开始',
  ai_reply: 'AI 回复',
  intent_branch: '意图分支',
  action: '动作',
  end: '结束',
};

export function NodePalette({ nodeTypes, disabled }: NodePaletteProps) {
  // NOTE: palette internals are deferred; this is the placeholder surface.
  return (
    <div className="qitu-node-palette qitu-canvas-pending" data-testid="node-palette-pending" role="note">
      <p className="qitu-canvas-pending-title">流程节点</p>
      <ul className="qitu-node-palette-list">
        {nodeTypes.map((type) => (
          <li key={type} className="qitu-node-palette-item" aria-disabled={disabled}>
            {LABELS[type]}
          </li>
        ))}
      </ul>
    </div>
  );
}
