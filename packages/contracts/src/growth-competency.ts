import { isGrowthEvidenceRef, type StudentGrowthEntryType } from './growth.js';

export const GROWTH_COMPETENCY_FRAMEWORK_VERSION = 'qitu.growth-competency-framework.v1' as const;
export const GROWTH_COMPETENCY_DIMENSIONS = [
  { id: 'problem_discovery', title: '问题发现', description: '从真实情境中发现问题，提出清楚、可以探究的问题。', evidenceGuidance: '可积累问题草稿、提出问题的依据和修改记录。' },
  { id: 'scientific_inquiry', title: '科学探究', description: '提出假设、设计比较，并依据观察与证据解释结果。', evidenceGuidance: '可积累假设、变量与对照设计、观察记录和证据分析。' },
  { id: 'logical_modeling', title: '逻辑建模', description: '用概念、关系、公式或模型组织解释，检查推理是否成立。', evidenceGuidance: '可积累推理过程、模型表达、适用条件和检验记录。' },
  { id: 'practical_creation', title: '实践创造', description: '把方案转化为作品，依据测试和反馈持续改进。', evidenceGuidance: '可积累方案、作品版本、测试记录和修改依据。' },
  { id: 'collaborative_expression', title: '协作表达', description: '清楚表达观点，回应他人反馈，在协作中承担任务。', evidenceGuidance: '可积累有依据的表达、协作分工和回应反馈的记录。' },
  { id: 'reflection_transfer', title: '反思迁移', description: '回看证据和策略变化，尝试把理解用于新的情境。', evidenceGuidance: '可积累反思、策略调整依据和新情境中的应用记录。' },
] as const;

export type GrowthCompetencyDimensionId = typeof GROWTH_COMPETENCY_DIMENSIONS[number]['id'];
export interface GrowthCompetencyDimensionMetadata {
  id: GrowthCompetencyDimensionId;
  title: string;
  description: string;
  evidenceGuidance: string;
}

/** Reserved for a future owner-issued rubric receipt; the current producer emits none. */
export interface GrowthCompetencyAssessment {
  receiptId: string;
  rubricId: string;
  rubricVersion: string;
  scaleId: string;
  scaleMin: number;
  scaleMax: number;
  assessedAt: string;
}

export type GrowthCompetencyDimension = GrowthCompetencyDimensionMetadata & (
  | { status: 'pending_observation'; value: null; evidenceRefs: readonly []; assessment: null }
  | { status: 'observed' | 'pending_assessment'; value: null; evidenceRefs: readonly [string, ...string[]]; assessment: null }
  | { status: 'assessed'; value: number; evidenceRefs: readonly [string, ...string[]]; assessment: GrowthCompetencyAssessment }
);

export type GrowthCompetencyDimensionSet = readonly [
  GrowthCompetencyDimension, GrowthCompetencyDimension, GrowthCompetencyDimension,
  GrowthCompetencyDimension, GrowthCompetencyDimension, GrowthCompetencyDimension,
];

export interface GrowthCompetencyReferenceRecord {
  growthRecordId: string;
  title: string;
  type: StudentGrowthEntryType;
  occurredAt: string;
  projectId: string | null;
  evidenceRefs: readonly [string, ...string[]];
}

export interface GrowthCompetencyOverview {
  frameworkVersion: typeof GROWTH_COMPETENCY_FRAMEWORK_VERSION;
  assessmentUnavailableReason: 'framework_not_configured' | 'no_confirmed_assessment' | null;
  dimensions: GrowthCompetencyDimensionSet;
  /** Existing growth records for context; their presence assigns no dimension or ability. */
  unassignedEvidence: readonly GrowthCompetencyReferenceRecord[];
}

/** A presentation framework is not an assessment configuration or an assessment result. */
export function createPendingGrowthCompetencyDimensions(): GrowthCompetencyDimensionSet {
  const pending = (metadata: GrowthCompetencyDimensionMetadata): GrowthCompetencyDimension => ({
    ...metadata, status: 'pending_observation', value: null, evidenceRefs: [], assessment: null,
  });
  const [a, b, c, d, e, f] = GROWTH_COMPETENCY_DIMENSIONS;
  return [pending(a), pending(b), pending(c), pending(d), pending(e), pending(f)];
}

/** Strict API boundary; null is never coerced to zero, and every canonical axis occurs once. */
export function parseGrowthCompetencyOverview(value: unknown): GrowthCompetencyOverview | null {
  const raw = object(value);
  if (!raw || !only(raw, ['frameworkVersion', 'assessmentUnavailableReason', 'dimensions', 'unassignedEvidence'])
    || raw.frameworkVersion !== GROWTH_COMPETENCY_FRAMEWORK_VERSION || !Array.isArray(raw.dimensions) || raw.dimensions.length !== 6
    || !Array.isArray(raw.unassignedEvidence) || raw.unassignedEvidence.length > 6) return null;
  const reason = raw.assessmentUnavailableReason;
  if (reason !== null && reason !== 'framework_not_configured' && reason !== 'no_confirmed_assessment') return null;
  const axes = new Map<GrowthCompetencyDimensionId, GrowthCompetencyDimension>();
  for (const item of raw.dimensions) {
    const axis = parseDimension(item);
    if (!axis || axes.has(axis.id)) return null;
    axes.set(axis.id, axis);
  }
  const [a, b, c, d, e, f] = GROWTH_COMPETENCY_DIMENSIONS.map((metadata) => axes.get(metadata.id));
  if (!a || !b || !c || !d || !e || !f) return null;
  const dimensions: GrowthCompetencyDimensionSet = [a, b, c, d, e, f];
  if (dimensions.some((axis) => axis.status === 'assessed') ? reason !== null : reason === null) return null;
  const unassignedEvidence: GrowthCompetencyReferenceRecord[] = [];
  const recordIds = new Set<string>();
  for (const item of raw.unassignedEvidence) {
    const record = parseReference(item);
    if (!record || recordIds.has(record.growthRecordId)) return null;
    recordIds.add(record.growthRecordId);
    unassignedEvidence.push(record);
  }
  return { frameworkVersion: GROWTH_COMPETENCY_FRAMEWORK_VERSION, assessmentUnavailableReason: reason, dimensions, unassignedEvidence };
}

function parseDimension(value: unknown): GrowthCompetencyDimension | null {
  const raw = object(value);
  if (!raw || !only(raw, ['id', 'title', 'description', 'evidenceGuidance', 'status', 'value', 'evidenceRefs', 'assessment'])) return null;
  const metadata = GROWTH_COMPETENCY_DIMENSIONS.find((item) => item.id === raw.id);
  if (!metadata || metadata.title !== raw.title || metadata.description !== raw.description || metadata.evidenceGuidance !== raw.evidenceGuidance) return null;
  const refs = evidenceRefs(raw.evidenceRefs);
  if (!refs) return null;
  if (raw.status === 'pending_observation') {
    return raw.value === null && raw.assessment === null && refs.length === 0
      ? { ...metadata, status: 'pending_observation', value: null, evidenceRefs: [], assessment: null } : null;
  }
  const [first, ...rest] = refs;
  if (!first) return null;
  if (raw.status === 'observed' || raw.status === 'pending_assessment') {
    return raw.value === null && raw.assessment === null
      ? { ...metadata, status: raw.status, value: null, evidenceRefs: [first, ...rest], assessment: null } : null;
  }
  const assessment = parseAssessment(raw.assessment);
  if (raw.status !== 'assessed' || !assessment || typeof raw.value !== 'number' || !Number.isFinite(raw.value)
    || raw.value < assessment.scaleMin || raw.value > assessment.scaleMax) return null;
  return { ...metadata, status: 'assessed', value: raw.value, evidenceRefs: [first, ...rest], assessment };
}

function parseAssessment(value: unknown): GrowthCompetencyAssessment | null {
  const raw = object(value);
  if (!raw || !only(raw, ['receiptId', 'rubricId', 'rubricVersion', 'scaleId', 'scaleMin', 'scaleMax', 'assessedAt'])
    || !identifier(raw.receiptId) || !identifier(raw.rubricId) || !identifier(raw.rubricVersion) || !identifier(raw.scaleId)
    || typeof raw.scaleMin !== 'number' || !Number.isFinite(raw.scaleMin)
    || typeof raw.scaleMax !== 'number' || !Number.isFinite(raw.scaleMax) || raw.scaleMin >= raw.scaleMax || !timestamp(raw.assessedAt)) return null;
  return { receiptId: raw.receiptId, rubricId: raw.rubricId, rubricVersion: raw.rubricVersion, scaleId: raw.scaleId,
    scaleMin: raw.scaleMin, scaleMax: raw.scaleMax, assessedAt: raw.assessedAt };
}

function parseReference(value: unknown): GrowthCompetencyReferenceRecord | null {
  const raw = object(value);
  if (!raw || !only(raw, ['growthRecordId', 'title', 'type', 'occurredAt', 'projectId', 'evidenceRefs'])
    || !identifier(raw.growthRecordId) || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 240
    || !growthType(raw.type) || !timestamp(raw.occurredAt) || (raw.projectId !== null && !identifier(raw.projectId))) return null;
  const refs = evidenceRefs(raw.evidenceRefs);
  const [first, ...rest] = refs ?? [];
  return first ? { growthRecordId: raw.growthRecordId, title: raw.title, type: raw.type, occurredAt: raw.occurredAt,
    projectId: raw.projectId, evidenceRefs: [first, ...rest] } : null;
}

function evidenceRefs(value: unknown): string[] | null {
  return Array.isArray(value) && value.length <= 32 && value.every(isGrowthEvidenceRef) && new Set(value).size === value.length ? [...value] : null;
}
function identifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9:._-]{1,200}$/u.test(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)); }
function growthType(value: unknown): value is StudentGrowthEntryType { return ['project_stage_completed', 'artifact_published', 'reflection_created', 'objective_mastered'].some((type) => type === value); }
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function only(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
