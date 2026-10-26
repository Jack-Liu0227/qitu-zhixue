> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../../README.md) 和各责任域文档。

# Student AI Partner Optics Flow QA

> 状态：先前边界测试记录；本轮编译与完成情况以 00 报告及 08 验证记录为准。

Date: 2026-10-21
Status: boundary-verified; live E2E pending
Scope: `/student/tutor`, the Tutor API data source, and the frozen optics PBL runtime contract.

This is an integration-style browser-boundary test, not a production-data replay. The test stubs the API boundary and exercises the same `TutorApiDataSource` methods used by the student page. No student transcript, token, or credential is stored in this document.

## Verified flow

`tooling/test-tutor-live-boundary.mjs` now covers one deterministic flow:

1. Create a free exploration session through the server-owned exploration endpoint.
2. Confirm the recommendation with an idempotency key and retry the same confirmation.
3. Assert that the returned project carries the frozen `templateVersionId`, `bindingId`, `teamVersionId`, `bindingHash`, and `bundleDigest`.
4. Open a project Tutor session and read the lesson schedule, phase preview, team status, redacted team messages, and tool-call timeline.
5. Submit a knowledge-check answer twice and assert that the second response is an idempotent replay.
6. Attempt an optics experiment before `TheoryMastered` and assert the server gate is surfaced as a 409; then run the bounded model after the gate passes.
7. Assert that the browser never writes `/stage`, `/mastery`, or `/growth` facts directly.

Run with:

```text
pnpm --filter @qitu/student-center test
```

The current run passed 23 feature tests and 6 live-boundary tests.

## Issues and solutions

### 1. UNC workspace dependency snapshots block a full API typecheck

- Symptom: `pnpm --filter @qitu/api typecheck` resolves stale `node_modules/@qitu/contracts` and `@qitu/database` snapshots and reports missing exports that exist in the workspace sources.
- Reproduction: run the API typecheck from the UNC workspace after changing contracts or Drizzle schemas; offline reinstall also fails when pnpm tries to create a UNC symlink for `@turbo/windows-64`.
- Root cause: the workspace dependency graph is not refreshed in this network-mounted checkout; the failure is environmental, not evidence that the Tutor contract is invalid.
- Security/data impact: a stale type graph can hide a real authorization regression if it is treated as a successful check. It must not be used as release evidence.
- Fix: build `@qitu/contracts` and `@qitu/database` first, record the snapshot limitation, then run focused source-path checks and behavior tests. Refresh dependencies on a local filesystem before release validation.
- Regression test: contract/database builds and `pnpm --filter @qitu/student-center test` are required in CI; API typecheck must run on a workspace with current package links.
- Remaining risk: production CI still needs one clean API/worker typecheck and integration run after dependency refresh.

### 2. Live Teaching Bundle compilation is not connected

- Symptom: an Admin draft can be stored, but a formal optics binding without a compiled payload/digest is rejected with `BUNDLE_COMPILATION_UNAVAILABLE`.
- Reproduction: validate or confirm a PBL template after saving canonical skill/MCP/knowledge-base references but before the server-owned catalog compiler attaches the payload.
- Root cause: the binding hash now includes `bundleDigest`, but the live runtime catalog-to-`TeachingBundleSource` compiler is not yet wired into the publish path.
- Security/data impact: allowing the draft through would authorize a runtime against unverified tools, models, or knowledge-base scopes. Fail-closed behavior is intentional.
- Fix: keep validation fail-closed and implement the compiler as a server owner that reads the live catalog, writes the compiled payload/digest, and revalidates the binding before activation.
- Regression test: missing digest/payload must fail; a compiled payload with a matching digest must be accepted and frozen into the project snapshot.
- Remaining risk: Admin UI must show the compile/publish error distinctly from a normal save success.

### 3. Internal Tutor evidence references were incompatible with Growth allow-list

- Symptom: team-runtime projection candidates containing internal `tutor_turn:*` references were rejected by the Growth contract.
- Reproduction: project a Tutor turn directly into a growth candidate and validate its evidence refs.
- Root cause: Growth accepts only opaque, bounded, allow-listed references; persisted Tutor turn IDs are implementation details and can expose more correlation data than the projection contract permits.
- Security/data impact: passing raw/internal IDs would increase linkage risk for minor data and could make an unreviewed runtime event look like a learner fact.
- Fix: keep persisted Tutor turns unchanged but emit an opaque allow-listed `help_request:<session>:<seq>` event reference at the projection boundary; Growth still validates source ownership and accepted evidence before publishing.
- Regression test: worker projection tests reject raw payloads and accept only the opaque reference form.
- Remaining risk: the event reference format must remain versioned if event partitioning changes.

### 4. Observation owner receipt is incomplete

- Symptom: an optics action has `specVersion`, `objectiveId`, stable `actionId`, bounded parameters, and an idempotency key, but the browser cannot yet prove that a persisted observation was accepted by the owner.
- Reproduction: submit `record_observation` and inspect the response and durable project/works evidence.
- Root cause: the action protocol is wired before the observation owner receipt/reference persistence is complete.
- Security/data impact: showing a slider result as measured evidence could incorrectly advance mastery, approve a work, or enter the growth projection.
- Fix: persist an owner receipt with project/session/revision scope and observation provenance; render “saved” only after that receipt is returned. Keep model simulation, simulated observation, and real measurement separate.
- Regression test: a missing or rejected receipt must render pending/error and must not write mastery, stage, artifact, or growth facts.
- Remaining risk: real experiments still require teacher safety review; a UI safety hint is not an authorization.

### 5. Parent profile projection is incomplete

- Symptom: the student profile reads accepted `learner_profile` and `growth_trajectory` projections, while the parent-specific accepted read contract is not complete.
- Reproduction: request the parent projection for a student with accepted and pending candidates.
- Root cause: the owner/review path is implemented first, but the parent audience projection and minimum-visibility policy still need a dedicated read model.
- Security/data impact: exposing the student projection directly to a parent could reveal excessive minor data or unreviewed evidence.
- Fix: add a parent-specific server projection with object-level permission checks, minimum-visible fields, audit logging, and accepted-only filtering. Do not copy raw conversations or full knowledge-base documents.
- Regression test: parent reads exclude pending/rejected rows and fields outside the approved visibility contract; cross-student reads return 403.
- Remaining risk: policy review is required before enabling the parent endpoint in production.

### 6. Full event-to-page E2E remains unverified

- Symptom: the boundary test verifies API-source behavior and the existing component suite verifies rendering, but a real browser has not yet exercised the entire flow against a running API/database.
- Reproduction: the current test command uses deterministic fetch stubs; no seeded end-to-end environment is available on this UNC checkout.
- Root cause: dependency snapshots and environment setup prevent a reliable live service run in this workspace.
- Security/data impact: browser routing, SSE reconnect, permission failures, and stale request identity can still regress between the API contract and the page.
- Fix: run `tooling/verify-e2e-live.sh` (or the project Playwright suite) in a disposable seeded environment with non-production identities. Cover offline, 403, SSE reconnect, lost confirmation response, and refresh identity cases.
- Regression test: retain the deterministic boundary test as a fast gate and add the live browser suite as a release gate.
- Remaining risk: until the live suite is green, the result is “contract verified,” not production acceptance.

## Release decision

The student Tutor contract is safe to merge for deterministic boundary coverage. Do not mark the optics runtime fully released until the live Teaching Bundle compiler, observation owner receipt, parent projection, and live browser E2E gaps above are closed.

## 2026-10-21 implementation follow-up

See [Student Tutor QA fixes and verification](./student-tutor-qa-fixes-20261021.md) for the compiler wiring, persisted simulation observation receipts, parent accepted-only read contract, clean-worktree builds and real API/database/browser checks. Relevant API tests pass 320/320; the full API run still has 17 reproduced baseline fixture failures. Synthetic catalogs and practice-gate fixtures are explicitly identified; this is not production acceptance.
