-- No destructive rollback: role definitions edited through the governance UI must be exported before removing this column.
ALTER TABLE "tutor_partners" DROP COLUMN IF EXISTS "role_definition";
