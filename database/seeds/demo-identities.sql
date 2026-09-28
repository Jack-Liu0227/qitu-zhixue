-- 启途智学 — 确定性的开发/测试种子数据
--
-- 幂等：可重复执行。
--   schools          —— 冲突时**修正**（DO UPDATE）。演示学校是校域维度的固定 fixture。
--   users            —— 冲突时**修正**（DO UPDATE）。身份与口令是固定 fixture，
--                       必须与文档里的登录凭据一致；若某个库里残留了旧口令
--                       （例如早期用 dummy hash 灌过数据），DO NOTHING 会把这个
--                       错误永久固化，表现为「登录一直 401 却查不出原因」。
--   guardian_links / mentor_assignments
--                    —— 冲突时**保留**（DO NOTHING）。这些是运行期可变的关系，
--                       用户可能刻意解绑过；种子不能把它复活。
-- 内容与当前 API 内存实现严格一致，作为 Stage 2「单一真源」切换的对照基线：
--   services/api/src/modules/identity-auth/auth.service.ts   (users)
--   services/api/src/modules/platform-data/platform-data.service.ts (导师关系)
--   services/api/src/modules/growth/growth.service.ts        (家长关系)
--
-- 校域说明：演示账号统一挂到 school-demo。school_id 为 NULL 表示平台共享数据
-- （见 docs/decisions/0006-domain-module-storage.md）。
--
-- 密码方案说明（重要）：
--   password_hash 存的是 sha256(明文) 的十六进制，与当前 auth.service.ts 的
--   safePasswordEqual()（对两边取 sha256 后做定时安全比较）语义等价，
--   因此 Stage 2 改为查库校验时不需要更换算法。
--   这是 demo 级方案，正式用户上线前必须替换为 scrypt/argon2 等带盐 KDF。
--
-- 执行：pnpm --filter @qitu/database seed
--       psql "$DATABASE_URL" -f database/seeds/demo-identities.sql

BEGIN;

-- 0. 学校（校域维度；NULL = 平台共享，这里提供一所演示学校）
INSERT INTO schools (id, code, name, status, created_at, updated_at)
VALUES ('school-demo', 'DEMO', '演示学校', 'active', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  code       = EXCLUDED.code,
  name       = EXCLUDED.name,
  status     = EXCLUDED.status,
  updated_at = NOW();

-- 1. 身份（9 个演示账号，id/email/role 与内存实现完全一致）
INSERT INTO users (id, email, display_name, role, password_hash, school_id, created_at, updated_at)
VALUES
  ('student-demo',   'student@qtzx.local',  '演示学生',   'student', '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b', 'school-demo', NOW(), NOW()),
  ('student-demo-2', 'student2@qtzx.local', '演示学生二', 'student', '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b', 'school-demo', NOW(), NOW()),
  ('student-demo-3', 'student3@qtzx.local', '演示学生三', 'student', '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b', 'school-demo', NOW(), NOW()),
  ('student-demo-4', 'student4@qtzx.local', '演示学生四', 'student', '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b', 'school-demo', NOW(), NOW()),
  ('parent-demo',    'parent@qtzx.local',   '演示家长',   'parent',  '82e3edf5f5f3a46b5f94579b61817fd9a1f356adcef5ee22da3b96ef775c4860', 'school-demo', NOW(), NOW()),
  ('parent-demo-2',  'parent2@qtzx.local',  '演示家长二', 'parent',  '82e3edf5f5f3a46b5f94579b61817fd9a1f356adcef5ee22da3b96ef775c4860', 'school-demo', NOW(), NOW()),
  ('teacher-demo',   'teacher@qtzx.local',  '演示班主任',   'teacher', 'cde383eee8ee7a4400adf7a15f716f179a2eb97646b37e089eb8d6d04e663416', 'school-demo', NOW(), NOW()),
  ('teacher-demo-2', 'teacher2@qtzx.local', '演示班主任二', 'teacher', 'cde383eee8ee7a4400adf7a15f716f179a2eb97646b37e089eb8d6d04e663416', 'school-demo', NOW(), NOW()),
  ('admin-demo',     'admin@qtzx.local',    '演示管理员',   'admin',   '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'school-demo', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  email         = EXCLUDED.email,
  display_name  = EXCLUDED.display_name,
  role          = EXCLUDED.role,
  password_hash = EXCLUDED.password_hash,
  school_id     = EXCLUDED.school_id,
  updated_at    = NOW();

-- 2. 班主任分配（一名学生同一时间只能有一个当前班主任）
--    teacher-demo   -> student-demo, student-demo-3
--    teacher-demo-2 -> student-demo-2, student-demo-4
INSERT INTO mentor_assignments (id, student_user_id, mentor_user_id, status, assigned_at)
VALUES
  ('mentor-assign-1', 'student-demo',   'teacher-demo',   'active', NOW()),
  ('mentor-assign-2', 'student-demo-3', 'teacher-demo',   'active', NOW()),
  ('mentor-assign-3', 'student-demo-2', 'teacher-demo-2', 'active', NOW()),
  ('mentor-assign-4', 'student-demo-4', 'teacher-demo-2', 'active', NOW())
ON CONFLICT DO NOTHING;

-- 3. 家长监护关系
--    parent-demo   -> student-demo, student-demo-3
--    parent-demo-2 -> student-demo-2
INSERT INTO guardian_links (id, parent_user_id, student_user_id, relationship, status, created_at)
VALUES
  ('guardian-link-1', 'parent-demo',   'student-demo',   'guardian', 'active', NOW()),
  ('guardian-link-2', 'parent-demo',   'student-demo-3', 'guardian', 'active', NOW()),
  ('guardian-link-3', 'parent-demo-2', 'student-demo-2', 'guardian', 'active', NOW())
ON CONFLICT DO NOTHING;

COMMIT;
