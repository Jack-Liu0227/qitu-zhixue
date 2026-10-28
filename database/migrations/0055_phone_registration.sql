ALTER TABLE users ADD COLUMN phone text;
ALTER TABLE users ADD COLUMN phone_verified_at timestamptz;
DROP INDEX users_email_lower_idx;
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email)) WHERE email <> '';
CREATE UNIQUE INDEX users_phone_unique_idx ON users (phone);
ALTER TABLE users ADD CONSTRAINT users_login_present CHECK (email <> '' OR (phone IS NOT NULL AND phone_verified_at IS NOT NULL));
ALTER TABLE users ADD CONSTRAINT users_phone_format CHECK (phone IS NULL OR phone ~ '^\+861[3-9][0-9]{9}$');
CREATE TABLE registration_sms (
  id text PRIMARY KEY, request_key text NOT NULL, phone_hash text NOT NULL, client_hash text NOT NULL,
  code_hash text NOT NULL, status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'used')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), used_by text,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX registration_sms_request_idx ON registration_sms (request_key);
CREATE INDEX registration_sms_phone_idx ON registration_sms (phone_hash, created_at);
CREATE INDEX registration_sms_client_idx ON registration_sms (client_hash, created_at);
