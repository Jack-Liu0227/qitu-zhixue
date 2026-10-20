-- Visual selection is independent of teaching templates, team versions and mastery.
CREATE TABLE visual_bindings (
  key text PRIMARY KEY,
  owner_kind text NOT NULL CHECK (owner_kind IN ('platform','assistant','team','template','template-version','knowledge')),
  owner_id text NOT NULL,
  usage text NOT NULL CHECK (usage IN ('avatar','icon','cover','illustration')),
  asset_id text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  operation_key text NOT NULL,
  operation_hash text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_kind, owner_id, usage)
);
