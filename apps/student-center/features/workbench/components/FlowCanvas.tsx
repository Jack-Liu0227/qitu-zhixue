'use client';

import type { FlowEdge, FlowNode } from '../types/workbench';

/**
 * Narrow canvas contract. The interactive canvas is not built yet, so the
 * internals are deliberately deferred. This interface is the shape the
 * eventual canvas must satisfy.
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
  // NOTE: the canvas internals are deferred; this is the placeholder surface.
  return (
    <div className="qitu-flow-canvas qitu-canvas-pending" data-testid="flow-canvas-pending" role="note">
      <p className="qitu-canvas-pending-title">画布正在准备中</p>
      <p className="qitu-canvas-pending-body">
        这里暂时还不能画流程图。你可以先切换到「代码」或「模拟器」，继续完成这个项目。
        节点和连线已经记录好了，画布上线后就能直接在这里编辑。
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
