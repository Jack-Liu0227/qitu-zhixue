# Admin platform registry and initialization

## Endpoints

- `GET /api/v1/admin/ai-runtime` returns redacted runtime projections. Requires an authenticated `admin` session.
- `GET /api/v1/admin/initialization` returns database, knowledge foundation, template foundation, and session-memory foundation checks. Requires an authenticated `admin` session.
- `POST /api/v1/admin/initialization/{knowledge|template|tutor}/execute` runs the corresponding platform-owned, idempotent foundation insert. Requires an authenticated `admin` session and `Idempotency-Key`. The `tutor` area initializes only a synthetic, student-independent strategy memory and its pending index outbox event.
- `POST /api/v1/admin/initialization/database/execute` always returns `409 INITIALIZATION_OPERATOR_REQUIRED`. Schema migrations stay on the deployment/CLI path.

The memory foundation contains no student id, conversation, transcript, voice, or raw minor evidence. It is not returned as content in admin projections; the registry reports readiness by stable fixture id only.

## Errors and retry behavior

- `IDEMPOTENCY_KEY_REQUIRED` (400): missing or invalid key.
- `IDEMPOTENCY_CONFLICT` (409): the key is in flight or was used for another request.
- `INITIALIZATION_AREA_INVALID` (400): unsupported initialization area.
- `INITIALIZATION_OPERATOR_REQUIRED` (409): migration execution attempted through HTTP.
- `INITIALIZATION_DATABASE_UNAVAILABLE` (503): a persistent database is required.
- `INITIALIZATION_EXECUTION_FAILED` (503): execution or audit transaction failed. The same key may be retried; no raw database error is returned or logged.

The idempotency record is persistent and scoped by area. Foundation inserts and the audit entry share a transaction. Stable fixture IDs and `ON CONFLICT DO NOTHING` make foundation data safe to initialize again with another key as well.

## Tests

`initialization.service.test.ts` covers schema guards, tutor foundation privacy and pending outbox creation, refusal to run against the in-memory database mode, and the idempotent execution boundary.
