> 状态：原日期的方案或验证记录；2026-10-26 整理仅补充分类与引用，不新增功能完成或生产验收结论。

# Profile and growth runtime repair

Date: 2026-10-22

## Grounding and decision

The Admin assistant directory and worker identities previously used different IDs.
The purpose picker intersected those IDs, returning an empty directory even though
the two intended assistants were enabled. Admin model edits also updated a table
that projection workers did not read.

Admin assistant IDs are now the canonical projection identities. An explicit Admin
purpose save provisions missing runtime identity descriptors and exact event routes
in its revision-checked transaction. Disabled identities and revoked routes remain
disabled. Existing history keeps its recorded producer ID.

Projection execution reads the current Admin model pair, prompt, and canonical
published teaching skills on every job. Runtime descriptors retain identity and
revocation responsibility. Ordinary teaching delegates retain their existing path.

The alternative of mapping the two legacy worker aliases was rejected because it
would spread dual-identity rules through settings, enqueueing, execution, review,
and public provenance. The design review selected canonical descriptors and added
the evidence reconciler's replay and owner-validation rules.

## Ownership and evidence

The Growth module reconciles bounded authoritative project, publication, reflection,
and mastery evidence. It does not consume another worker's mastery outbox messages.
It records official growth facts through the existing Growth service, then writes
idempotent team events. A retry repairs the gap if a process stops between those
writes. No new PBL or mastery state store is introduced.

Model results remain proposals. Existing Growth owner acceptance revalidates the
current purpose, route, student/project scope, source evidence, and base version.
The finite domain-observation policy accepts only source-backed factual wording;
participation and conversation never establish ability, mastery, or approved work.

Auxiliary projection runs use waiting state and never claim or complete the active
Tutor run. Student reads refresh only their scoped persisted growth records, with
request identity guarding against stale refreshes. Visible analysis pages re-read
every 15 seconds and on focus; reads never invoke generation.

## Verification and release checklist

- [x] Inspect local and remote worktree changes and preserve unrelated files.
- [x] Compare canonical-descriptor and alias-map designs; review source ownership.
- [x] Complete config, evidence, execution, review, and display implementation.
- [x] Build dependency packages from source and run API/worker regressions.
- [x] Validate transactional uniqueness and replay in a disposable fixture.
- [x] Build affected applications and verify authorized browser behavior.
- [x] Commit only this repair, deliver to study-remote, and verify live behavior.

Production configuration readiness, fixture behavior, real model requests, and
page rendering are reported separately. Tests must not inject mastery or accept
candidates by editing production tables.

## Source verification

The source verifier passed on the current study-remote worktree baseline, including
139 preserved unrelated changed files. Run `run-1792600866466-1504090` passed 96 API
and 37 worker behavior tests, affected Admin/student TypeScript checks, and six
disposable PGlite transaction/queue groups. The fixture derives actual Drizzle
constraints, preserves the active Tutor run, and verifies generation serialization
until an actual owner rejection receipt. It does not connect to production or call
model providers. Production builds and live model acceptance are separate gates.

## Release verification

The repair is deployed from study-remote main. The final merged-source run
`run-1792602524896-1532114` passed 99 API and 38 worker tests, nine additional
concurrent-module regressions, and six disposable PostgreSQL fixture groups.
API, worker, Admin and student production builds passed.

Live testing exposed two gaps missed by the original mocked-model tests: the
model needed the owner's complete closed output schema, and the current free
exploration owner is the exact server-declared intake assistant. Both gaps were
fixed and regression-tested without relaxing owner acceptance. One normal
synthetic exploration turn then produced an accepted profile v1 and trajectory
v2, both matched to that same server event. Visible-page auto-refresh and mobile
rendering passed. Historical invalid candidates were not force-accepted.

See [release evidence](../../admin/release-profile-growth-20261022.md) and
[machine-readable verification](../../admin/release-profile-growth-20261022.json).
