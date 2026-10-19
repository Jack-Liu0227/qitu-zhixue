import { getPhaseAndRoleForSession, parseProjectTemplateSpec, validateProjectTemplateSpec } from '@qitu/contracts';
import { OPTICS_TEMPLATE_SPEC } from './content.js';
import { OPTICS_16_SESSION_TEMPLATE_SPEC } from './curriculum.js';

export function runOpticsCurriculumAssertions(): void {
  const spec = OPTICS_16_SESSION_TEMPLATE_SPEC;
  const profile = spec.curriculum?.profiles[0];
  if (profile === undefined) throw new Error('16-session profile missing');
  if (parseProjectTemplateSpec(spec) !== spec) throw new Error('Parser must not rewrite template content');
  if (OPTICS_TEMPLATE_SPEC.version !== 'v1' || OPTICS_TEMPLATE_SPEC.curriculum !== undefined) throw new Error('Legacy template was changed');
  if (!validateProjectTemplateSpec(OPTICS_TEMPLATE_SPEC).valid) throw new Error('Legacy template no longer parses');
  const first = profile.sessions[0];
  if (first === undefined) throw new Error('First session missing');
  const replaceFirst = (session: unknown): unknown => ({ ...spec, curriculum: { profiles: [{ ...profile, sessions: [session, ...profile.sessions.slice(1)] }] } });
  const invalidInputs: readonly unknown[] = [
    null, [], {}, { ...spec, apiKey: 'not-a-real-key' },
    { ...spec, ageRange: { min: 15.5, max: 18 } },
    { ...spec, objectives: [...spec.objectives, spec.objectives[0]] },
    { ...spec, objectives: spec.objectives.map((objective, index) => index === 0 ? { ...objective, prerequisiteIds: ['missing'] } : objective) },
    { ...spec, objectives: spec.objectives.map((objective, index) => index === 0 ? { ...objective, prerequisiteIds: ['opt-intent-question'] } : objective) },
    { ...spec, phases: [...spec.phases].reverse() },
    { ...spec, curriculum: { profiles: [{ ...profile, sessions: profile.sessions.slice(1) }] } },
    replaceFirst({ ...first, sessionIndex: 1.5 }),
    replaceFirst({ ...first, week: 2 }),
    replaceFirst({ ...first, session: 0 }),
    replaceFirst({ ...first, objectiveIds: ['opt-practice-measure'] }),
    replaceFirst({ ...first, durationMinutes: 59 }),
    replaceFirst({ ...first, blocks: { ...first.blocks, review: -1 } }),
    replaceFirst({ ...first, blocks: { ...first.blocks, theory: 30.5 } }),
    replaceFirst({ ...first, blocks: { ...first.blocks, review: 11 } }),
    replaceFirst({ ...first, checkpoint: { requiredGate: 'TheoryMastered' } }),
    replaceFirst({ ...first, checkpoint: { requiredGate: 'student_confirmed_intent', completed: true } }),
    replaceFirst({ ...first, learningGoal: '' }),
    replaceFirst({ ...first, activityGuidance: { practice: 'not scheduled' } }),
    replaceFirst({ ...first, activityGuidance: { reflect: '' } }),
    replaceFirst({ ...first, activityGuidance: { advance_stage: 'forbidden' } }),
    replaceFirst({ ...first, evidenceRequirements: [''] }),
    replaceFirst({ ...first, evidenceRequirements: [] }),
    replaceFirst({ ...first, evidenceRequirements: [{ accepted: true }] }),
  ];
  for (const [index, input] of invalidInputs.entries()) {
    if (validateProjectTemplateSpec(input).valid) throw new Error(`Invalid template accepted: ${index}`);
  }
  for (const index of [-1, 0, 1.5, 17, Number.NaN, Number.POSITIVE_INFINITY]) {
    let rejected = false;
    try { getPhaseAndRoleForSession(index, profile); } catch { rejected = true; }
    if (!rejected) throw new Error(`Invalid session index accepted: ${index}`);
  }
  const checkpoint = getPhaseAndRoleForSession(8, profile);
  if (!checkpoint.isGateSession || checkpoint.gateCondition !== 'TheoryMastered'
    || 'mastered' in checkpoint || 'practiceUnlocked' in checkpoint) throw new Error('Checkpoint became a completion fact');
  for (const [offset, session] of profile.sessions.entries()) {
    const expected = offset < 2 ? 'exploration' : offset < 8 ? 'concept_mastery' : offset < 14 ? 'guided_practice' : 'deliverable_review';
    if (getPhaseAndRoleForSession(offset + 1, profile).phase !== expected) throw new Error('Requested lesson phase mismatch');
    if (Object.values(session.blocks).reduce((sum, minutes) => sum + minutes, 0) !== 60) throw new Error('Lesson duration mismatch');
  }
  for (const [index, gate] of [[2, 'student_confirmed_intent'], [8, 'TheoryMastered'], [14, 'experiment_report_validated'], [16, 'review_completed_and_archived']] as const) {
    if (getPhaseAndRoleForSession(index, profile).gateCondition !== gate) throw new Error('Checkpoint owner mismatch');
  }
  const shortened = { ...profile, sessions: [{ ...first, phase: 'deliverable_review' as const }] };
  if (getPhaseAndRoleForSession(1, shortened).phase !== 'deliverable_review') throw new Error('Resolver guessed phase from numeric range');
}
