# Database boundary

PostgreSQL is the system of record. Database migrations are owned by the API/domain layer and must be reviewed with the module that owns the tables.

Planned responsibilities:

- `migrations/`: forward-only schema migrations with rollback notes
- `seeds/`: deterministic development/test data only
- `fixtures/`: isolated test fixtures, never production data

The initial repository does not create business tables. M1 will introduce identity, household, guardian link, session and audit migrations before project tables are added.
