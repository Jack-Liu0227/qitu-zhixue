# Profile and growth release verification

Date: 2026-10-22. Target: `study-remote`, canonical worktree `/root/qitu-zhixue`.
Source commits: `30f677d`, `47ac588`, `b497da1`.

## Changes deployed

- Explicit Admin purpose saves provision exact runtime identities and event routes.
  Existing disabled identities and revoked routes stay disabled. The default
  free-exploration intake identity and actual live/frozen team leaders are covered.
- Projection jobs read current Admin instructions, canonical published skills and
  the complete provider/model pair. Prompts receive the owner's closed JSON result
  schema. Models still produce candidates, not official learning facts.
- The Growth owner reconciles existing project transitions, approved publications,
  scoped reflections and current mastered-objective evidence. Durable replay uses
  existing stores and does not compete with the mastery outbox consumer.
- A dedicated `qitu-profile-growth.service` consumes projection jobs only. Same
  student/type generation waits for the previous owner receipt. Analysis runs do
  not occupy or finish a Tutor run.
- Student reads refresh persisted growth evidence. Visible profile and growth
  analysis pages re-read every 15 seconds and on focus, without invoking models.

## Verification

Final source run: `run-1792602524896-1532114`. Dependencies were compiled from source
in order, rather than relying on installed workspace output snapshots.

| Gate | Result |
| --- | --- |
| API growth/parent/Tutor-event behavior | 99 passed |
| Worker behavior | 38 passed |
| Concurrent Tutor identity/team-publication regressions | 9 passed |
| Disposable PostgreSQL transaction/queue groups | 6 passed |
| Affected Admin and student TypeScript checks | passed |
| API and worker production builds | passed |
| Admin and student Next production builds | passed |

The PostgreSQL fixture derives actual Drizzle columns, foreign keys and unique
indexes. It checks rollback, save replay, descriptor/route revocation, Tutor active
run uniqueness, duplicate events, mailbox lease acknowledgements and generation
serialization until a real owner rejection receipt. It never connects to the
production database or calls a provider. PGlite 0.5.11 is installed outside the
repository under `/root/qitu-validation/profile-growth-deps`.

Re-run the source verification with:

```sh
QITU_VERIFY_DEPENDENCY_ROOT=/root/qitu-validation/profile-growth-deps \
  node tooling/verify-profile-growth.mjs
```

## Live acceptance

The two purposes were saved through the authenticated Admin page and read back
at revision 66. Both are ready. Their existing `deepseek / deepseek-flash` model
pairs were retained; no credential or provider route was changed.

One ordinary synthetic free-exploration Tutor request returned HTTP 200 without
an SSE error frame. Read-only database metadata matched both accepted candidates
to that same session: profile v1 and trajectory v2, both `tutor-expression.v1`.
No formal project was created, and no production learning fact, mastery state or
acceptance result was injected through SQL or a fixture.

The student pages display the accepted interest and evidence-bounded summary.
They retain these results while newer candidates are pending. A visible page
performed an automatic read within 17 seconds. Desktop 1440x1000 and mobile
390x844 checks passed without horizontal overflow or page exceptions.
Anonymous profile access returned 401; student access to Admin settings returned
403. Concurrent API restarts caused transient 401/502 during QA; authenticated
display checks were repeated after recovery instead of treating those requests
as successful.

API readiness reports `live`, with database and Redis probes both `ok`.
API, Admin, student and the dedicated projection worker are active and enabled,
using the canonical worktree. API and projection worker processes run as postgres.
The unrelated general worker service was not enabled.

## Boundaries and preservation

Existing local changes were kept in their original worktree. The repair was made
in an isolated worktree. Remote commits stage only this repair; 147 preserved
parallel source changes were included in the final isolated verification but not
folded into these commits.

Historical failed and noncompliant candidates remain available for owner review.
Explicit purpose saves retry only outbox failures caused by missing purposes;
they do not reset model failures, revoked routes or previously reviewed candidates.
The first live attempts correctly deferred noncompliant JSON. The closed schema
fix was retested with real model requests rather than bypassing the validator.

Formal domain-event fan-in is verified with disposable fixtures, not a complete
live 16-session project. Ability weights, event and privacy toggles remain strategy
previews. This release does not infer ability scores or turn dialogue into mastery,
approved work or formal milestones. No schema migration or second PBL state store
was introduced.

Runtime/source backups are in `/root/qitu-backups/profile-growth-20261022`.
Do not reset the dirty worktree when rolling back. Stop the affected services,
restore their backed-up artifacts, and preserve current unrelated source changes.

See [sanitized machine-readable evidence](./release-profile-growth-20261022.json)
and [architecture decision](../plan/codex/profile-growth-runtime-20261022.md).
