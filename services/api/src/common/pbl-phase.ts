const PROJECT_PHASE_BY_STAGE: Readonly<Record<string, string>> = Object.freeze({
  exploration: 'exploration',
  intent_confirmed: 'concept_mastery',
  theory: 'concept_mastery',
  theory_learning: 'concept_mastery',
  theory_check: 'concept_mastery',
  practice: 'guided_practice',
  practice_ready: 'guided_practice',
  practice_building: 'guided_practice',
  review: 'deliverable_review',
  artifact_review: 'deliverable_review',
  reflection: 'deliverable_review',
  published: 'deliverable_review',
  completed: 'deliverable_review',
});

/** One server-owned mapping from project stage to the bound PBL team's phase. */
export function pblPhaseForProjectStage(stage: string): string {
  return PROJECT_PHASE_BY_STAGE[stage] ?? 'concept_mastery';
}
