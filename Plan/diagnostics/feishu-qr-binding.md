# Feishu QR Authorization Lifetime Fix

Date: 2026-10-19. Scope: `/admin/settings/feishu` and the existing Feishu module.
No navigation, learning-state, recipient-scope, or database schema changes.

## Cause And Behavior

- Device authorization initially returned `verification_uri_complete`, but pending polls
  called the legacy OAuth projection. Its empty/different URL replaced the displayed QR
  on the first client poll, previously scheduled after three seconds.
- Starting again encountered an active server session whose verification URL had not
  been retained, producing `FEISHU_QR_ALREADY_ACTIVE` instead of restoring the QR.
- New sessions retain the verification URL and opaque device code together as a
  versioned JSON payload inside the existing AES-GCM `device_code_encrypted` field.
  No new credential store or migration is required. Only the verification URL is
  returned to the authenticated session creator; the device code is never returned.
- The same administrator can resume an unexpired device session by requesting QR
  authorization again, including after page reload. Expiry is unchanged on resume.
  Pre-fix opaque encrypted device codes remain pollable. If their QR URL is missing,
  only their creator can retire the session and request a replacement.
- Pending client polls preserve the original QR image and URL, including when an
  older API returns an empty or legacy URL. Terminal statuses remove the QR.
- Poll requests are sequential and wait for the provider's interval after completion;
  `slow_down` increases this delay. Provider expiry is neither shortened to ten
  minutes nor extended to a fabricated minimum. Expired sessions require a new QR.
- Late responses after assistant/domain switching or page unmount are ignored.

## Permission, Errors, And Audit

- Creation/resume remains Admin-only, behind the existing actor/assistant-scoped
  idempotency handler. QR reads and device polls additionally check `createdBy`.
- Another administrator cannot resume or replace the active session. The existing
  `FEISHU_QR_ALREADY_ACTIVE` code now has an actionable message.
- Invalid provider timing or undecryptable authorization data returns HTTP 503;
  cross-owner reads/polls return HTTP 403. Storage failures remain fail-closed.
- Legacy replacement uses a pending-status/creator compare-and-set. A concurrent
  completion/replacement returns HTTP 409 `FEISHU_QR_SESSION_CHANGED` without
  overwriting the new status or creating a duplicate authorization.
- Replacing an unrecoverable pre-fix session records `admin.feishu.device.cancel`
  with the assistant ID and `verification_url_unavailable` reason. Creation and
  successful binding retain their existing audit actions. URLs/codes are not logged.
- Offline/transient client polling failures keep the QR visible and retry. Permission
  failures stop polling; provider expiry/cancellation shows a retryable terminal state.

## Verification And Release Boundary

- Validation result: 36 Feishu API tests and four frontend regression tests pass;
  focused API/Admin TypeScript checks, lint baseline and diff whitespace checks pass.
- `node --test tooling/feishu-qr.test.mjs` covers pending QR retention, terminal-state
  removal, provider intervals, non-overlap, slow-down, late responses, offline retry,
  permission denial, and terminal polling shutdown.
- Feishu API tests include repeated pending polls, same-owner resume with unchanged
  expiry, encrypted payloads, legacy compatibility/replacement, cross-owner denial,
  provider timing, slow-down, expiry, and completed sessions with erased device codes.
  Run compiled `modules/feishu/*.test.js` after building actual workspace dependencies.
- An isolated Playwright harness renders the actual page and API adapter against
  fixture responses: baseline disappearance is reproduced, then the fix is checked
  on desktop/mobile, through reload, expiry, and assistant-switch races. This is not
  a real tenant authorization or message-delivery acceptance test.
- Full-workspace checks encounter pre-existing PBL source/install-snapshot mismatches
  and a missing `pdfjs-dist` installation. Do not classify those as Feishu failures
  or claim that the full repository passes. Existing unrelated changes in
  `Plan/codex`, contracts/curriculum, optics quiz-bank, PBL/API modules and
  bootstrap/verification tooling are preserved and outside this fix.
- Deploy the updated API and Admin client together. The new API reads old ciphertexts;
  old API processes cannot interpret the new encrypted JSON payload and must not
  continue serving polls after rollout. No live credentials or production data are
  altered by the tests; real phone confirmation remains a release check.
