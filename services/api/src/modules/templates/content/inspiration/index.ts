import { SEED_OBSERVATION_COURSE } from './seed-observation';
import { PACKAGING_REDUCTION_COURSE } from './packaging-reduction';
import { LIBRARY_DATA_COURSE } from './library-data';
import { WAYFINDING_COURSE } from './wayfinding';
import { OBJECT_HISTORY_COURSE } from './object-history';
import { CHOICE_STORY_COURSE } from './choice-story';
import { CLAIM_VERIFICATION_COURSE } from './claim-verification';
import { CREATIVE_BUDGET_COURSE } from './creative-budget';

export { type InspirationCourse } from './course-builder';
export const INSPIRATION_COURSES = [SEED_OBSERVATION_COURSE, PACKAGING_REDUCTION_COURSE, LIBRARY_DATA_COURSE,
  WAYFINDING_COURSE, OBJECT_HISTORY_COURSE, CHOICE_STORY_COURSE, CLAIM_VERIFICATION_COURSE, CREATIVE_BUDGET_COURSE] as const;
