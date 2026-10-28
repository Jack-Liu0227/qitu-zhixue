# P1/P2 Completion Status

## P1: project templates and agent teams

- **Template governance**: server-side create/update/version/archive APIs are available; admin editor now uses them with idempotency keys.
- **PBL workflow**: phase gates, `TheoryMastered`, prompts, team binding, and schedule are stored in immutable template versions.
- **Agent team runtime**: team configuration remains server-owned; browser state is display-only and cannot mutate project state, mastery, review, or audit facts.
- **Remaining acceptance**: verify a logged-in admin can create, edit, archive, and reload a template from the deployed API; verify audit records and permission failures.

## P2: runtime migration and pilot

- **Schedule migration**: supports the legacy weekly plan and explicit `1 x 120` or `2 x 60` minute sessions with validation.
- **Evidence review**: artifact evidence is validated before review candidates are produced; AI output is not a final approval.
- **Pilot**: still requires a real classroom run with minors-data minimization, offline/error states, and upload/review evidence.

## Release gates

1. Contract and focused service tests pass.
2. No secrets, raw minor conversations, or credentials are included.
3. Permission, idempotency, audit, and server-owned state checks are demonstrated.
4. Browser evidence covers loading, empty, error, offline, and permission-denied states.
