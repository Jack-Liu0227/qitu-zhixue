# P2 Release Readiness

Before pushing to the server or GitHub:

- Run `git diff --check` and inspect the complete staged file list.
- Reject `.env`, tokens, private keys, authentication files, and unsanitized minor data.
- Run contracts typecheck and focused learning-plan, evidence, review, and template governance tests.
- Label browser checks as deployed live, mock, or blocked by authentication; do not present mock evidence as live evidence.
- Verify backend object permissions, idempotency replay behavior, audit writes, and server-owned status transitions.
- Verify the UI has loading, empty, error, offline, and permission-failure states.
- Verify student visibility is minimized and only published template versions are exposed to students.

Promotion requires a successful deployed admin template round trip, a successful student schedule round trip, and an uploaded artifact whose review candidate is traceable to evidence and requires human approval before acceptance.
