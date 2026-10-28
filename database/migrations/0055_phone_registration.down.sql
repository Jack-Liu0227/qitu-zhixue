-- Never discard phone accounts to roll back a login migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE email = '') THEN
    RAISE EXCEPTION 'Phone-only accounts exist; provide replacement login identifiers before rollback';
  END IF;
END $$;
DROP TABLE registration_sms;
ALTER TABLE users DROP CONSTRAINT users_phone_format;
ALTER TABLE users DROP CONSTRAINT users_login_present;
DROP INDEX users_phone_unique_idx;
DROP INDEX users_email_lower_idx;
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));
ALTER TABLE users DROP COLUMN phone_verified_at;
ALTER TABLE users DROP COLUMN phone;
