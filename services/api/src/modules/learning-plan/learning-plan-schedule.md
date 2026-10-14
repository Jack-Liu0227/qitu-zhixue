# Learning plan schedule migration

`plan-generator.ts` accepts the versioned `PblSchedule` contract through the
optional `GeneratePlanInput.schedule` field.

| Request shape | Sessions generated | Session length |
| --- | ---: | ---: |
| Legacy `{ interest, weeks, goal }` | `weeks * 5` | 60 minutes |
| `sessionsPerWeek: 1` | `durationWeeks * 1` | 120 minutes |
| `sessionsPerWeek: 2` | `durationWeeks * 2` | 60 minutes |

For scheduled requests, `durationWeeks` must equal the legacy `weeks` field and
the schedule must satisfy the shared `PblSchedule` validator (`weeklyMinutes`
is 120). The generated plan keeps `schedule` so persistence and API adapters
can adopt it incrementally. Requests without `schedule` retain the existing
five-session-per-week behavior.

The legacy `@qitu/ai-client` draft validator is still run for 60-minute plans.
It currently assumes 60-minute sessions, so 120-minute plans use the local
generator validator for block totals, objective references, prerequisites, and
theory-before-practice gates.
