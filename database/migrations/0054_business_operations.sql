CREATE TABLE business_settings (
  id text PRIMARY KEY, revision integer NOT NULL CHECK (revision >= 0), content jsonb NOT NULL,
  last_automation_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE business_offers (
  id text PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0),
  template_version_id text NOT NULL REFERENCES project_template_versions(id),
  status text NOT NULL CHECK (status IN ('draft','published','archived')),
  requires_purchase boolean NOT NULL, content jsonb NOT NULL, published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_offers_version_idx ON business_offers(template_version_id);
CREATE TABLE business_orders (
  id text PRIMARY KEY, buyer_id text NOT NULL REFERENCES users(id), student_id text NOT NULL REFERENCES users(id),
  offer_id text NOT NULL REFERENCES business_offers(id), template_version_id text NOT NULL REFERENCES project_template_versions(id),
  offer_snapshot jsonb NOT NULL, terms_snapshot jsonb NOT NULL,
  amount_fen integer NOT NULL CHECK (amount_fen > 0 AND amount_fen <= 10000000),
  status text NOT NULL CHECK (status IN ('pending','paid','refund_requested','refunding','refunded','cancelled')),
  request_key text NOT NULL, request_hash text NOT NULL, transaction_id text,
  checkout_url text, checkout_expires_at timestamptz NOT NULL,
  paid_at timestamptz, access_until timestamptz, refund_reason text, refund_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((paid_at IS NULL AND access_until IS NULL) OR (paid_at IS NOT NULL AND access_until > paid_at)),
  CHECK (status NOT IN ('paid','refund_requested','refunding','refunded') OR transaction_id IS NOT NULL)
);
CREATE UNIQUE INDEX business_orders_request_idx ON business_orders(buyer_id,request_key);
CREATE UNIQUE INDEX business_orders_transaction_idx ON business_orders(transaction_id);
CREATE INDEX business_orders_student_version_idx ON business_orders(student_id,template_version_id);
CREATE INDEX business_orders_buyer_idx ON business_orders(buyer_id,created_at);
CREATE TABLE business_tasks (
  id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('lead','refund','delivery')),
  reference_id text NOT NULL, title text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX business_tasks_reference_idx ON business_tasks(kind,reference_id);
CREATE TABLE business_model_usage (
  id text PRIMARY KEY, provider_id text NOT NULL, model_id text NOT NULL, usage_id text NOT NULL,
  input_tokens integer CHECK (input_tokens >= 0), output_tokens integer CHECK (output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_model_usage_created_idx ON business_model_usage(created_at);
CREATE TABLE business_expenses (
  id text PRIMARY KEY, category text NOT NULL CHECK (category IN ('ai','payment','hosting','support','other')),
  amount_fen integer NOT NULL CHECK (amount_fen >= 0), minutes integer NOT NULL CHECK (minutes >= 0),
  note text NOT NULL, order_id text REFERENCES business_orders(id), request_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_expenses_request_idx ON business_expenses(request_key);
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY, id text NOT NULL, user_id text NOT NULL REFERENCES users(id),
  device_id text NOT NULL, device_name text NOT NULL, created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE TABLE family_invitations (
  id text PRIMARY KEY, parent_email text NOT NULL, parent_name text NOT NULL,
  student_email text NOT NULL, student_name text NOT NULL, expires_at timestamptz NOT NULL,
  accepted_at timestamptz, accepted_hash text, policy_revision integer,
  parent_id text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
