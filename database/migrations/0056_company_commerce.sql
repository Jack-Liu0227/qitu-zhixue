ALTER TABLE business_orders ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE business_orders ALTER COLUMN offer_id DROP NOT NULL;
ALTER TABLE business_orders ALTER COLUMN template_version_id DROP NOT NULL;
ALTER TABLE business_orders ALTER COLUMN offer_snapshot DROP NOT NULL;
ALTER TABLE business_orders ADD COLUMN subscription jsonb;
ALTER TABLE business_orders ADD COLUMN service_starts_at timestamptz;
ALTER TABLE business_orders ADD COLUMN refund_amount_fen integer;
ALTER TABLE business_orders ADD CONSTRAINT business_orders_product_check CHECK
 ((subscription IS NULL AND offer_id IS NOT NULL AND offer_snapshot IS NOT NULL AND template_version_id IS NOT NULL AND student_id IS NOT NULL) OR
  (subscription IS NOT NULL AND offer_id IS NULL AND offer_snapshot IS NULL AND template_version_id IS NULL));
ALTER TABLE business_orders ADD CONSTRAINT business_orders_refund_check CHECK (refund_amount_fen IS NULL OR refund_amount_fen BETWEEN 1 AND amount_fen);
CREATE TABLE commerce_products (id text PRIMARY KEY, revision integer NOT NULL, content jsonb NOT NULL);
CREATE TABLE commerce_policies (id text PRIMARY KEY, content jsonb NOT NULL);
CREATE TABLE commerce_organizations (id text PRIMARY KEY, name text NOT NULL, created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE commerce_grants (id text PRIMARY KEY, order_id text REFERENCES business_orders(id), student_id text NOT NULL REFERENCES users(id), organization_id text REFERENCES commerce_organizations(id), product jsonb NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, revoked_at timestamptz, CHECK (ends_at > starts_at));
CREATE UNIQUE INDEX commerce_grants_order_student_idx ON commerce_grants(order_id, student_id);
CREATE INDEX commerce_grants_student_idx ON commerce_grants(student_id);
CREATE TABLE commerce_project_access (project_id text PRIMARY KEY, student_id text NOT NULL REFERENCES users(id), template_version_id text NOT NULL, grant_id text REFERENCES commerce_grants(id), source text NOT NULL CHECK (source IN ('free','grant','legacy')), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE commerce_usage (id text PRIMARY KEY, student_id text NOT NULL REFERENCES users(id), grant_id text REFERENCES commerce_grants(id), bucket text NOT NULL, status text NOT NULL CHECK (status IN ('reserved','committed','released')), lease_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX commerce_usage_bucket_idx ON commerce_usage(student_id, bucket);
CREATE TABLE company_members (user_id text PRIMARY KEY REFERENCES users(id), role text NOT NULL CHECK (role IN ('owner','operator','analyst','viewer')), active boolean NOT NULL DEFAULT true);
CREATE TABLE company_teams (department text PRIMARY KEY, assistant_id text, enabled boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 0);
CREATE TABLE company_work (id text PRIMARY KEY, created_by text NOT NULL REFERENCES users(id), title text NOT NULL, department text NOT NULL, brief text NOT NULL, status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')), result text, error text, attempts integer NOT NULL DEFAULT 0, lease_token text, lease_until timestamptz, request_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX company_work_request_idx ON company_work(created_by, request_key);
CREATE TABLE company_knowledge (id text PRIMARY KEY, title text NOT NULL, content text NOT NULL, revision integer NOT NULL, updated_by text NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE company_channels (id text PRIMARY KEY, assistant_id text NOT NULL, app_id text NOT NULL, chat_id text NOT NULL, sender_hash text NOT NULL, user_id text NOT NULL REFERENCES users(id), department text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE UNIQUE INDEX company_channels_binding_idx ON company_channels(assistant_id, app_id, chat_id, sender_hash, department);
CREATE TABLE company_messages (id text PRIMARY KEY, channel_id text NOT NULL REFERENCES company_channels(id), work_id text REFERENCES company_work(id), delivery jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
