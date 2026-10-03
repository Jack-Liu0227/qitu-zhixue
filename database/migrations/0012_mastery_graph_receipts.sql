CREATE TABLE IF NOT EXISTS "mastery_graph_receipts" (
  "event_id" text PRIMARY KEY NOT NULL REFERENCES "mastery_events"("id") ON DELETE RESTRICT,
  "school_id" text REFERENCES "schools"("id") ON DELETE RESTRICT,
  "backend" text DEFAULT 'graphiti' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "payload_hash" text NOT NULL,
  "projection_id" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "lease_owner" text,
  "lease_until" timestamp with time zone,
  "last_error" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mastery_graph_receipts_status_idx"
  ON "mastery_graph_receipts" ("status", "lease_until");
