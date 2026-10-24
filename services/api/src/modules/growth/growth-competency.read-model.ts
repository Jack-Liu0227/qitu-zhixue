import {
  createPendingGrowthCompetencyDimensions,
  GROWTH_COMPETENCY_FRAMEWORK_VERSION,
  normalizeGrowthEvidenceRefs,
  type GrowthCompetencyOverview,
  type GrowthCompetencyReferenceRecord,
  type StudentGrowthEntry,
  type GrowthCompetencyDimension,
} from '@qitu/contracts';
import type { CompetencyObservations } from '../learning-insights/learning-insights.service';

/** Composes authorized references using learning-footprints.v1; observations are never scores. */
export function buildGrowthCompetencyOverview(recentGrowth: readonly StudentGrowthEntry[], observations: CompetencyObservations = {}): GrowthCompetencyOverview {
  const unassignedEvidence: GrowthCompetencyReferenceRecord[] = [];
  const seen = new Set<string>();
  for (const record of recentGrowth) {
    if (seen.has(record.id)) continue;
    const [first, ...rest] = normalizeGrowthEvidenceRefs(record.evidenceIds, 32);
    if (!first) continue;
    seen.add(record.id);
    unassignedEvidence.push({ growthRecordId: record.id, title: record.title.slice(0, 240),
      type: record.type, occurredAt: record.occurredAt, projectId: record.projectId, evidenceRefs: [first, ...rest] });
    if (unassignedEvidence.length === 6) break;
  }
  const observe = (axis: GrowthCompetencyDimension): GrowthCompetencyDimension => {
    const [first, ...rest] = normalizeGrowthEvidenceRefs(observations[axis.id], 32);
    return first ? { ...axis, status: 'observed', evidenceRefs: [first, ...rest], value: null, assessment: null } : axis;
  };
  const [a, b, c, d, e, f] = createPendingGrowthCompetencyDimensions();
  return { frameworkVersion: GROWTH_COMPETENCY_FRAMEWORK_VERSION, assessmentUnavailableReason: 'framework_not_configured',
    dimensions: [observe(a), observe(b), observe(c), observe(d), observe(e), observe(f)], unassignedEvidence };
}
