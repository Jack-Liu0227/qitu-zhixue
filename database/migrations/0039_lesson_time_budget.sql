-- Rename the learner profile budget to a lesson-scoped value.
-- Historical migration files remain immutable; no weekly compatibility column is retained.
ALTER TABLE tutor_learner_profiles
  RENAME COLUMN time_budget_minutes_per_week TO time_budget_minutes;
