import type {
  PedagogicMove,
  ProjectStage,
  TemplateStage,
  WorkbenchConflictDetails,
} from '@qitu/contracts';

/**
 * Workbench draft kinds. Tab labels map 1:1:
 * 流程设计 -> flow, 代码 -> code, 模拟器 -> sim, 测试 -> test.
 */
export type WorkbenchKind = 'flow' | 'code' | 'sim' | 'test';

/** Kinds that can be executed by the preview endpoint (sim runs separately). */
export type PreviewableKind = 'flow' | 'code' | 'test';

export type FlowNodeType = 'start' | 'ai_reply' | 'intent_branch' | 'action' | 'end';

/**
 * Node/edge data shape for the flow draft.
 *
 * NOTE: this is the *data contract only*. `FlowCanvas`/`NodePalette` rendering
 * is deferred until the canvas technology decision (self-rendered vs React
 * Flow) is made; this shape is what the eventual canvas must consume.
 */
export interface FlowNode {
  id: string;
  type: FlowNodeType;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
}

export interface FlowContent {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type CodeLanguage = 'python' | 'javascript' | 'typescript';

export interface CodeContent {
  language: CodeLanguage;
  source: string;
}

export interface SimScenario {
  botName: string;
  openingMessage: string;
  resetPrompt: string;
}

/** `kind='sim'` stores ONLY the scenario config, never the chat transcript. */
export interface SimContent {
  scenario: SimScenario;
}

export type TestCaseStatus = 'pending' | 'pass' | 'fail';

export interface TestCase {
  id: string;
  name: string;
  input: string;
  expected: string;
  status: TestCaseStatus;
}

export interface TestContent {
  cases: TestCase[];
}

export interface WorkbenchContentMap {
  flow: FlowContent;
  code: CodeContent;
  sim: SimContent;
  test: TestContent;
}

export type WorkbenchContent<K extends WorkbenchKind = WorkbenchKind> = WorkbenchContentMap[K];

export interface WorkbenchDraft<K extends WorkbenchKind = WorkbenchKind> {
  projectId: string;
  kind: K;
  /** Optimistic-lock revision; sent back as `If-Match`. Server-owned. */
  revision: number;
  content: WorkbenchContentMap[K];
  /** Server time (UTC ISO8601). */
  updatedAt: string;
}

export interface WorkbenchProject {
  id: string;
  title: string;
  coverUrl: string | null;
  /** Server-owned state machine value. The only valid gate source. */
  stage: ProjectStage;
  /** ILLUSTRATIVE ONLY — never read for a gate or permission decision. */
  currentStageIndex: number;
  stageTotal: number;
  progressPercent: number;
}

export interface WorkbenchStageProgress {
  stages: TemplateStage[];
  /** ILLUSTRATIVE ONLY — display index, not a gate. */
  currentStageIndex: number;
  stageTotal: number;
  progressPercent: number;
}

/**
 * Local offline buffer. Persisted to localStorage under
 * `qitu.workbench.buffer.<projectId>.<kind>`.
 *
 * It stores *draft content only* — never a chat transcript, voice or raw
 * tutor conversation (minor-safety rule).
 */
export interface WorkbenchBuffer<K extends WorkbenchKind = WorkbenchKind> {
  projectId: string;
  kind: K;
  baseRevision: number;
  content: WorkbenchContentMap[K];
  dirty: boolean;
  savedAt: string;
}

export interface WorkbenchConflict {
  kind: WorkbenchKind;
  localContent: WorkbenchContent;
  serverRevision: number;
  serverContent: WorkbenchContent;
  serverUpdatedAt: string | null;
  /** Raw contract details straight from the 409 problem response. */
  details: WorkbenchConflictDetails;
}

export interface SimulatorTranscriptEntry {
  role: 'student' | 'bot';
  text: string;
  at: string;
}

/**
 * SimulatorRun is persisted (replay/iterate) but is NOT project evidence:
 * evidence is aggregated server-side from TaskSubmission / TutorTurn /
 * EscalationEvent / Reflection only.
 */
export interface SimulatorRun {
  id: string;
  projectId: string;
  draftRevision: number;
  input: string;
  transcript: SimulatorTranscriptEntry[];
  createdAt: string;
}

export interface WorkbenchSnapshot {
  id: string;
  projectId: string;
  kind: WorkbenchKind;
  revision: number;
  content: WorkbenchContent;
  createdBy: string;
  createdAt: string;
}

export interface PreviewResult {
  runId: string;
  kind: PreviewableKind;
  status: 'ready' | 'failed';
  previewUrl: string | null;
  log: string | null;
}

/** Gap: no project-scoped suggestion endpoint exists yet (see handoff). */
export interface TutorSuggestion {
  id: string;
  move: PedagogicMove;
  title: string;
  body: string;
}

export type AutosaveStatusValue = 'idle' | 'saving' | 'saved' | 'offline-buffering' | 'conflict';

export type ConflictChoice = 'keep-mine' | 'use-server' | 'merge';

/** Thrown by the data source when `PATCH` returns the 409 optimistic lock. */
export class WorkbenchConflictError extends Error {
  readonly details: WorkbenchConflictDetails;

  constructor(details: WorkbenchConflictDetails) {
    super('workbench optimistic lock conflict');
    this.name = 'WorkbenchConflictError';
    this.details = details;
  }
}

export function isFlowContent(content: WorkbenchContent): content is FlowContent {
  return typeof content === 'object' && content !== null && 'nodes' in content && 'edges' in content;
}

export function isCodeContent(content: WorkbenchContent): content is CodeContent {
  return typeof content === 'object' && content !== null && 'source' in content && 'language' in content;
}

export function isSimContent(content: WorkbenchContent): content is SimContent {
  return typeof content === 'object' && content !== null && 'scenario' in content;
}

export function isTestContent(content: WorkbenchContent): content is TestContent {
  return typeof content === 'object' && content !== null && 'cases' in content;
}

/**
 * Deterministic flow merge: union by entity id; when both sides carry the same
 * id, the SERVER version wins. No text diff, no heuristics.
 */
export function mergeFlowContents(local: FlowContent, server: FlowContent): FlowContent {
  const nodes = new Map<string, FlowNode>();
  for (const node of local.nodes) nodes.set(node.id, node);
  for (const node of server.nodes) nodes.set(node.id, node);
  const edges = new Map<string, FlowEdge>();
  for (const edge of local.edges) edges.set(edge.id, edge);
  for (const edge of server.edges) edges.set(edge.id, edge);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
