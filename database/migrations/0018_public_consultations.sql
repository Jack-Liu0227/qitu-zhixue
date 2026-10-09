-- Public consultation leads from the marketing home page ("预约体验课 / 院校机构合作").
-- This migration is additive and safe to re-run during a rolling deployment.
--
-- Owner module: public-content. Distinct from `feedback_tickets`, which requires a
-- parent↔student relationship and is written exclusively by Mentor Ops.
CREATE TABLE IF NOT EXISTS "consultation_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "phone" text NOT NULL,
  "identity" text NOT NULL,
  "message" text,
  "status" text NOT NULL DEFAULT 'received',
  "source" text NOT NULL DEFAULT 'public-home',
  "idempotency_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "contacted_at" timestamptz
);

-- One lead per idempotency key: repeated clicks / network retries must not multiply rows.
CREATE UNIQUE INDEX IF NOT EXISTS "consultation_requests_idempotency_key_idx"
  ON "consultation_requests" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "consultation_requests_status_idx"
  ON "consultation_requests" ("status", "created_at");
