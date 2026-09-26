'use client';

import type { FlowEdge, FlowNode } from '../types/workbench';

/**
 * Narrow canvas contract. The rendering technology (self-rendered read-only vs
 * React Flow) is undecided, so the internals are deliberately NOT implemented.
 * This interface is the shape the eventual canvas must satisfy.
 */
export interface FlowCanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  readOnly: boolean;
  onSelectNode: (nodeId: string | null) => void;
  onNodesChange: (nodes: FlowNode[]) => void;
  onEdgesChange: (edges: FlowEdge[]) => void;
}

export function FlowCanvas({ nodes, edges, readOnly }: FlowCanvasProps) {
  // NOTE: canvas internals are deferred behind the technology decision.
  return (
    <div className="qitu-flow-canvas qitu-canvas-pending" data-testid="flow-canvas-pending" role="note">
      <p className="qitu-canvas-pending-title">画布待技术选型确认</p>
      <p className="qitu-canvas-pending-body">
        流程画布的渲染方案（自研 vs React Flow）尚未定稿，暂以占位替代。
        节点与连线数据已按合同就绪，选型落地后即可直接接入。
      </p>
      <dl className="qitu-canvas-pending-stats">
        <div>
          <dt>节点</dt>
          <dd>{nodes.length}</dd>
        </div>
        <div>
          <dt>连线</dt>
          <dd>{edges.length}</dd>
        </div>
        <div>
          <dt>可编辑</dt>
          <dd>{readOnly ? '否（当前只读）' : '是'}</dd>
        </div>
      </dl>
    </div>
  );
}
