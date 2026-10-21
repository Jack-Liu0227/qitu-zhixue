# Lesson-first learning plan

Learning plans are ordered lesson grids. A template selects `lessonCount` and `lessonMinutes`; each lesson owns one module and one session.

```json
{
  "interest": "optics inquiry",
  "lessonCount": 16,
  "lessonMinutes": 60,
  "curriculumSlug": "optics-physical-inquiry-16s"
}
```

## Contract rules

- `lessonCount` is an integer from 1 through 128.
- `lessonMinutes` is 60 or 120, and every session has the same duration.
- `lessonIndex` is one-based and contiguous for modules and sessions.
- Curriculum phases (`exploration`, `concept_mastery`, `guided_practice`, `deliverable_review`) are governance metadata; they do not own schedule data.
- The 8th, 14th, and 16th lessons are checkpoints only. A checkpoint never writes mastery, artifact approval, or archive facts by itself.
- Plan signatures use `(student, templateVersion, interest, lessonCount, lessonMinutes)`.

## Lesson blocks

Each lesson may contain `review`, `theory`, `check`, `practice`, and `reflect` blocks. Their minutes must sum exactly to `lessonMinutes`. Practice remains gated by the server-owned TheoryMastered state.

## Persistence

`learning_plans` stores `lesson_count` and `lesson_minutes`; `learning_modules` and `learning_sessions` store `lesson_index`. The database no longer accepts calendar placement fields.
