-- 0031_answer_attempts
-- F1 判分路由的交互题作答证据表。
-- 只保存学生自己的作答（canonical selectedKeys）与判分元数据；
-- 标准答案（expectedKeys / explanation）只存在于代码级题库，绝不落本表。

CREATE TABLE IF NOT EXISTS "answer_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "school_id" text REFERENCES "schools"("id") ON DELETE RESTRICT,
  "student_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "tutor_session_id" text NOT NULL REFERENCES "tutor_sessions"("id") ON DELETE RESTRICT,
  "quiz_id" text NOT NULL,
  "objective_id" text REFERENCES "learning_objectives"("id") ON DELETE RESTRICT,
  "plan_id" text REFERENCES "learning_plans"("id") ON DELETE RESTRICT,
  "concept_id" text NOT NULL,
  "result" text NOT NULL,
  "is_correct" boolean NOT NULL DEFAULT false,
  "assessment_type" text NOT NULL DEFAULT 'quiz',
  "error_type" text,
  "hints_used" integer NOT NULL DEFAULT 0,
  "attempt_count" integer NOT NULL DEFAULT 1,
  "quality_basis_points" integer,
  "user_answer" text,
  "idempotency_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "answer_attempts_student_quiz_key_unique_idx"
  ON "answer_attempts" ("student_user_id", "quiz_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "answer_attempts_student_quiz_idx"
  ON "answer_attempts" ("student_user_id", "quiz_id");

CREATE INDEX IF NOT EXISTS "answer_attempts_student_created_idx"
  ON "answer_attempts" ("student_user_id", "created_at");

CREATE INDEX IF NOT EXISTS "answer_attempts_plan_objective_idx"
  ON "answer_attempts" ("plan_id", "objective_id");
