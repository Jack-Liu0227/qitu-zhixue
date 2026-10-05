ALTER TABLE "tutor_partners" ADD COLUMN IF NOT EXISTS "role_definition" text NOT NULL DEFAULT '';
UPDATE "tutor_partners"
SET "role_definition" = '以苏格拉底式提问支持学生探索、理解、练习与反思；不替学生完成作品，不绕过理论掌握门槛。'
WHERE "id" = 'qitu-learning-partner' AND "role_definition" = '';
