import {
  createPendingGrowthCompetencyDimensions,
  GROWTH_COMPETENCY_FRAMEWORK_VERSION,
  normalizeGrowthEvidenceRefs,
  type GrowthCompetencyOverview,
  type GrowthCompetencyReferenceRecord,
  type StudentGrowthEntry,
} from '@qitu/contracts';

/** Only composes already authorized growth references; there is no configured assessment mapping yet. */
export function buildGrowthCompetencyOverview(recentGrowth: readonly StudentGrowthEntry[]): GrowthCompetencyOverview {
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
  return { frameworkVersion: GROWTH_COMPETENCY_FRAMEWORK_VERSION, assessmentUnavailableReason: 'framework_not_configured',
    dimensions: createPendingGrowthCompetencyDimensions(), unassignedEvidence };
}
