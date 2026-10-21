# Teaching arrangement and six-dimension profile checkpoint

Date: 2026-10-22, Asia/Shanghai.

## Delivery boundary

Implementation exists in the isolated worktree on
`codex/teaching-profile-ui-20261022`, based on remote main
`5922577b018e00d7ec573bc9b3502cfbd35311f8` plus the captured, pre-existing
152-file remote source baseline. It is not a clean-main release assertion.
No production source, configuration, teaching binding or assessment was changed
by this UI task. Original local changes have not been overwritten or committed.

The original workspace has integration conflicts in
`apps/student-center/features/profile/ProfilePage.tsx` and
`packages/contracts/src/index.ts`. In particular, its profile currently removes
visible-page automatic refresh, while the tested remote baseline includes it.
Integration must resolve that difference explicitly instead of copying a file
over the user's work. A merge preview, source archive and baseline hashes are
kept outside the repository.

## Source verification

Runner: `node tooling/verify-teaching-profile-ui.mjs`.
Latest source run: `run-1792605723020-1560070`.

- Fresh dependency builds: contracts, database, infra, agent-memory, ai-client,
  model-runtime, then API and workers.
- API behavior: 106 passed, 0 failed.
- Worker behavior: 38 passed, 0 failed.
- Admin arrangement helpers: 5 passed, 0 failed.
- Student radar geometry and analysis messages: 7 passed, 0 failed.
- Total: 156 passed. Admin teaching-arrangement imports and student profile/growth
  imports were also typechecked against fresh source package declarations.
- Admin and student production builds passed at the first checkpoint. The final
  Admin build also passed after adding bounded skill descriptions. The final
  student build and browser checkpoint passed with the account reduced-motion
  selector.

The optional disposable PostgreSQL fixture was attempted separately and failed.
The captured pre-existing change in
`services/workers/src/team-runtime-mailbox-source.ts` removes the projection-only
guard and changes a partially completed analysis run from waiting to running.
The fixture's still-running Tutor then conflicts with
`agent_team_runs_active_mentor_unique_idx`. This task does not hide the failure,
disable the index, manufacture owner acceptance or reverse that user change.
Restoring isolation is a separate pending confirmation.

## Browser verification

Built previews run only on loopback, separate from production app ports. Normal
test-account login and real read-only API requests verify published team members,
the frozen model pair, skill pins and 16 actual lesson routes. No team, template,
binding or assessment publication is performed.

Admin checks passed:

- Published capabilities and active routes are read-only.
- At 390px, document width does not exceed the viewport.
- A browser-intercepted synthetic draft save whose readback fails retains the
  edit and does not report success. Retry uses the identical idempotency key and
  payload, then requires authoritative matching readback.
- Invalid advanced JSON is retained and cannot be saved. Discard restores the
  last confirmed draft.
- A browser-intercepted 403 displays a permission failure and disables mutation.

Student checks passed at the final browser checkpoint:

- Six interactive axes, arrow/Home/End navigation and a six-row alternative table.
- Missing assessment produces no result points or filled ability polygon.
- At 390px, no horizontal overflow.
- Existing night-mode surface colors change correctly. Both operating-system
  reduced motion and the account preference disable the dimension animation.
- Going offline retains the previous read-only profile; 403 clears it; 503 offers
  explicit retry.
- No uncaught page errors in the completed checks.

All 13 browser check groups passed across the Admin and student scripts.

Browser failures, draft writes and invalid JSON are explicit test fixtures, not
production facts. Screenshots and reports remain in temporary verification
storage; authentication state and student text are not committed.

## Remaining product scope

The hexagon is a six-dimension observation framework, not a newly enabled grading
system. Current server output has six null assessments and states that the
grading framework is not configured. Existing interests and accepted growth
summaries remain separate. They are not converted to grades by counts, keywords
or boolean lesson checks.

Real grades still require an Admin-governed versioned rubric and a connected
authoritative assessment producer. Historical projects and deleted source data
must not silently acquire new evaluation semantics.
