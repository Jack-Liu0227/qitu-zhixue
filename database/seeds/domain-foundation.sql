-- 启途智学 — 领域基础层（canonical domain foundation）演示数据
--
-- 覆盖新增的规范化表：schools 之外的 project_templates / project_template_versions /
-- knowledge_documents / knowledge_chunks / learning_plans(+modules/objectives/sessions) /
-- mastery_records / growth_records / student_memories / mentor_reviews；
-- 以及迁移 0009 的 template_verification_runs / artifacts / artifact_versions /
-- project_evidence / pending_questions。
-- 所有内容均为虚构演示数据，不含未成年人真实对话、语音或个人信息。
--
-- 幂等：可重复执行（模板/知识/计划等固定 fixture 冲突时 DO UPDATE；运行期记录 DO NOTHING）。
--
-- 说明：seed.ts 的 SEED_FILES 已包含本文件，会随 `pnpm seed` 在 demo-identities.sql 与
--       tutor-workspace.sql 之后自动执行；也可手动执行：
--       psql "$DATABASE_URL" -f database/seeds/domain-foundation.sql
--       演示账号需先由 demo-identities.sql 建立。
--
--       `template_verification_evidence` 由服务端在验证时按真实证据写入，种子没有可引用的
--       已完成项目（demo 项目仍在进行中），因此只种 `template_verification_runs` 一条
--       未通过报告，不虚构证据行。
--
-- 与 tutor_* 表的关系见 docs/admin/database.md：
-- tutor_template_documents / tutor_knowledge_documents 为工作区适配层，
-- 本文件的表为正式领域真源（两者暂时并存，合并计划见文档）。

BEGIN;

-- 1. 项目模板（NULL school_id = 平台共享；非空 = 校域私有）
INSERT INTO project_templates
  (id, school_id, slug, title, summary, domain, age_range, difficulty,
   estimated_duration_minutes, required_materials, learning_objectives,
   outcome_form, safety_notes, status, created_by, verified_by, verified_at, created_at, updated_at)
VALUES
  (
    'template-python-mini-project', NULL, 'python-mini-project',
    'Python 小项目：从兴趣到作品',
    '把一个喜欢的主题拆成探索、理论、实践、展示四个阶段，产出一个可运行的小作品。',
    'programming', '10-14', 'beginner', 480,
    '["电脑", "Python 3.11+", "任意编辑器"]'::jsonb,
    '["理解变量与输入输出", "能用条件与循环组织逻辑", "能调试并说明自己的程序"]'::jsonb,
    '可运行的 Python 程序 + 讲解稿', '使用电脑时保持正确坐姿与用眼休息。',
    'published', 'admin-demo', 'teacher-demo', NOW(), NOW(), NOW()
  ),
  (
    'template-story-game', NULL, 'story-game',
    '故事游戏创作模板',
    '用角色、规则和反馈循环做一个可玩的互动故事。',
    'design', '9-13', 'beginner', 360,
    '["纸笔", "可选：Scratch 账号"]'::jsonb,
    '["能定义角色与规则", "能画出分支结构", "能根据试玩反馈迭代"]'::jsonb,
    '可试玩的互动故事 + 设计说明', '避免包含可识别真实人物的负面情节。',
    'published', 'admin-demo', 'teacher-demo', NOW(), NOW(), NOW()
  ),
  (
    'template-school-ai-drawing', 'school-demo', 'ai-drawing',
    '校本：AI 辅助绘图小实验',
    '演示学校校本模板，用于验证校域模板与平台模板的隔离与并存。',
    'art', '8-12', 'beginner', 240,
    '["纸笔", "绘图软件（教师机）"]'::jsonb,
    '["能描述画面构成", "能对比 AI 与手绘的差异"]'::jsonb,
    '一组对比图 + 简短反思', '使用 AI 生成内容需教师在场并注明来源。',
    'published', 'teacher-demo', 'teacher-demo', NOW(), NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  school_id = EXCLUDED.school_id,
  slug = EXCLUDED.slug,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  domain = EXCLUDED.domain,
  age_range = EXCLUDED.age_range,
  difficulty = EXCLUDED.difficulty,
  estimated_duration_minutes = EXCLUDED.estimated_duration_minutes,
  required_materials = EXCLUDED.required_materials,
  learning_objectives = EXCLUDED.learning_objectives,
  outcome_form = EXCLUDED.outcome_form,
  safety_notes = EXCLUDED.safety_notes,
  status = EXCLUDED.status,
  verified_by = EXCLUDED.verified_by,
  verified_at = EXCLUDED.verified_at,
  updated_at = NOW();

-- 2. 模板版本（冻结内容；学习计划与项目通过 template_version_id 引用）
INSERT INTO project_template_versions
  (id, template_id, version, stages, content, rubric, status, created_by, published_at, created_at)
VALUES
  (
    'ptv-python-mini-v1', 'template-python-mini-project', 'v1',
    '[{"id":"exploration","label":"探索"},{"id":"theory","label":"理论"},{"id":"practice","label":"实践"},{"id":"showcase","label":"展示"}]'::jsonb,
    '{"theoryGate":true,"suggestedWeeks":[4,8],"sessionBlocks":["warmup","concept","practice","reflect"]}'::jsonb,
    '[{"id":"r1","criterion":"程序可运行","weight":40},{"id":"r2","criterion":"能解释逻辑","weight":40},{"id":"r3","criterion":"展示清晰","weight":20}]'::jsonb,
    'published', 'admin-demo', NOW(), NOW()
  ),
  (
    'ptv-story-game-v1', 'template-story-game', 'v1',
    '[{"id":"exploration","label":"探索"},{"id":"theory","label":"理论"},{"id":"practice","label":"实践"},{"id":"showcase","label":"展示"}]'::jsonb,
    '{"theoryGate":true,"suggestedWeeks":[4],"sessionBlocks":["warmup","concept","practice","reflect"]}'::jsonb,
    '[{"id":"r1","criterion":"规则自洽","weight":40},{"id":"r2","criterion":"可试玩","weight":40},{"id":"r3","criterion":"能讲清设计","weight":20}]'::jsonb,
    'published', 'admin-demo', NOW(), NOW()
  ),
  (
    'ptv-ai-drawing-v1', 'template-school-ai-drawing', 'v1',
    '[{"id":"exploration","label":"探索"},{"id":"theory","label":"理论"},{"id":"practice","label":"实践"},{"id":"showcase","label":"展示"}]'::jsonb,
    '{"theoryGate":false,"suggestedWeeks":[4],"sessionBlocks":["warmup","concept","practice","reflect"]}'::jsonb,
    '[{"id":"r1","criterion":"构图说明清楚","weight":50},{"id":"r2","criterion":"有对比反思","weight":50}]'::jsonb,
    'published', 'teacher-demo', NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  template_id = EXCLUDED.template_id,
  version = EXCLUDED.version,
  stages = EXCLUDED.stages,
  content = EXCLUDED.content,
  rubric = EXCLUDED.rubric,
  status = EXCLUDED.status,
  published_at = EXCLUDED.published_at;

-- 3. 知识（scope: system / school / project / student；embedding 暂以 JSONB 占位，pgvector 待接入）
INSERT INTO knowledge_documents
  (id, school_id, scope, owner_user_id, project_id, title, summary, tags, content,
   source, source_ref, checksum, version, status, verified_by, verified_at, created_at, updated_at)
VALUES
  (
    'knowledge-socratic-loop', NULL, 'system', NULL, NULL,
    '项目式学习对话原则',
    '每次只推进一个可观察的小目标，用问题、证据和反思帮助学生形成自己的判断。',
    '["苏格拉底式", "项目式学习", "反思"]'::jsonb,
    '对话先确认学生想做什么，再询问已有尝试和不确定点。AI 不替学生完成决策，也不直接写入成长档案；每个结论都要能关联到学生自己的回答、作品或反思。',
    'qitu-curriculum-policy', 'policy://socratic-loop', 'seed-socratic-loop-v1', 'v1',
    'verified', 'teacher-demo', NOW(), NOW(), NOW()
  ),
  (
    'knowledge-theory-gate', NULL, 'system', NULL, NULL,
    '理论掌握到实践解锁（TheoryMastered）',
    '实践任务必须建立在服务端确认的理论掌握之上。',
    '["TheoryMastered", "掌握度", "实践"]'::jsonb,
    '理论目标用服务端题目与反思检查；一次答对不足以通过掌握门槛。只有服务端产生 TheoryMastered 后，实践目标才可以开始，阈值默认 9000 基点。',
    'qitu-curriculum-policy', 'policy://theory-before-practice', 'seed-theory-gate-v1', 'v1',
    'verified', 'teacher-demo', NOW(), NOW(), NOW()
  ),
  (
    'knowledge-school-safety', 'school-demo', 'school', NULL, NULL,
    '演示学校：AI 使用与未成年人保护约定',
    '校域知识样例，用于验证按 school_id 隔离的知识检索。',
    '["校域", "未成年人保护", "AI 使用"]'::jsonb,
    '未成年人在校使用 AI 生成内容时需教师在场，生成结果须标注来源，不采集未成年人原始语音与可识别对话。',
    'demo-school-policy', 'school://demo/ai-policy', 'seed-school-safety-v1', 'v1',
    'verified', 'teacher-demo', NOW(), NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  school_id = EXCLUDED.school_id,
  scope = EXCLUDED.scope,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  tags = EXCLUDED.tags,
  content = EXCLUDED.content,
  source = EXCLUDED.source,
  source_ref = EXCLUDED.source_ref,
  checksum = EXCLUDED.checksum,
  version = EXCLUDED.version,
  status = EXCLUDED.status,
  verified_by = EXCLUDED.verified_by,
  verified_at = EXCLUDED.verified_at,
  updated_at = NOW();

INSERT INTO knowledge_chunks (id, document_id, ordinal, content, token_count, embedding, embedding_model, created_at)
VALUES
  ('kc-socratic-0', 'knowledge-socratic-loop', 0, '对话先确认学生想做什么，再询问已有尝试和不确定点。', 32, '[0.10,0.20,0.30]'::jsonb, 'placeholder-v1', NOW()),
  ('kc-theory-0', 'knowledge-theory-gate', 0, '一次答对不足以通过掌握门槛，需服务端累积掌握度达到阈值。', 30, '[0.11,0.22,0.33]'::jsonb, 'placeholder-v1', NOW()),
  ('kc-school-safety-0', 'knowledge-school-safety', 0, '未成年人使用 AI 生成内容需教师在场并标注来源。', 26, '[0.12,0.24,0.36]'::jsonb, 'placeholder-v1', NOW())
ON CONFLICT (id) DO UPDATE SET
  document_id = EXCLUDED.document_id,
  ordinal = EXCLUDED.ordinal,
  content = EXCLUDED.content,
  token_count = EXCLUDED.token_count,
  embedding = EXCLUDED.embedding,
  embedding_model = EXCLUDED.embedding_model;

-- 4. 学习计划（已确认意图的演示计划）+ 模块 / 目标 / 课次
INSERT INTO learning_plans
  (id, school_id, student_user_id, project_id, interest, goal, weeks, minutes_per_session,
   template_version_id, status, version, idempotency_key, confirmed_at, created_at, updated_at)
VALUES
  (
    'plan-demo-python', 'school-demo', 'student-demo', NULL,
    '用 Python 做一个猜数字小游戏', '8 周内独立完成并讲解一个可运行的小游戏', 8, 60,
    'ptv-python-mini-v1', 'active', 1, 'seed:plan:student-demo:python-mini', NOW(), NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  school_id = EXCLUDED.school_id,
  student_user_id = EXCLUDED.student_user_id,
  interest = EXCLUDED.interest,
  goal = EXCLUDED.goal,
  weeks = EXCLUDED.weeks,
  minutes_per_session = EXCLUDED.minutes_per_session,
  template_version_id = EXCLUDED.template_version_id,
  status = EXCLUDED.status,
  idempotency_key = EXCLUDED.idempotency_key,
  updated_at = NOW();

INSERT INTO learning_modules (id, plan_id, name, week_index, objective, ordinal, created_at)
VALUES
  ('lm-demo-w1', 'plan-demo-python', '第 1 周：认识变量与输入', 1, '写出能读取输入并回显的程序', 1, NOW()),
  ('lm-demo-w2', 'plan-demo-python', '第 2 周：条件与猜测循环', 2, '实现猜大猜小的判断循环', 2, NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, week_index = EXCLUDED.week_index,
  objective = EXCLUDED.objective, ordinal = EXCLUDED.ordinal;

INSERT INTO learning_objectives
  (id, plan_id, module_id, name, type, objective, prerequisite_ids, ordinal, created_at)
VALUES
  ('lo-demo-var', 'plan-demo-python', 'lm-demo-w1', '变量与类型', 'memory', '能说明变量保存了什么', '[]'::jsonb, 1, NOW()),
  ('lo-demo-io', 'plan-demo-python', 'lm-demo-w1', '输入与输出', 'procedure', '能用 input/print 完成交互', '["lo-demo-var"]'::jsonb, 2, NOW()),
  ('lo-demo-loop', 'plan-demo-python', 'lm-demo-w2', '条件与循环', 'concept', '能用循环和条件实现猜测判断', '["lo-demo-io"]'::jsonb, 1, NOW())
ON CONFLICT (id) DO UPDATE SET
  plan_id = EXCLUDED.plan_id, module_id = EXCLUDED.module_id, name = EXCLUDED.name,
  type = EXCLUDED.type, objective = EXCLUDED.objective,
  prerequisite_ids = EXCLUDED.prerequisite_ids, ordinal = EXCLUDED.ordinal;

INSERT INTO learning_sessions
  (id, plan_id, module_id, "index", blocks, theory_objective_ids, practice_objective_ids, mode, scheduled_for, created_at)
VALUES
  ('ls-demo-1', 'plan-demo-python', 'lm-demo-w1', 1,
   '["warmup","concept","quiz","reflect"]'::jsonb,
   '["lo-demo-var","lo-demo-io"]'::jsonb, '[]'::jsonb,
   'study', NOW() + interval '0 day', NOW()),
  ('ls-demo-2', 'plan-demo-python', 'lm-demo-w2', 2,
   '["warmup","concept","quiz","reflect"]'::jsonb,
   '["lo-demo-loop"]'::jsonb, '["lo-demo-loop"]'::jsonb,
   'study', NOW() + interval '7 day', NOW())
ON CONFLICT (id) DO UPDATE SET
  module_id = EXCLUDED.module_id, "index" = EXCLUDED."index", blocks = EXCLUDED.blocks,
  theory_objective_ids = EXCLUDED.theory_objective_ids,
  practice_objective_ids = EXCLUDED.practice_objective_ids,
  mode = EXCLUDED.mode, scheduled_for = EXCLUDED.scheduled_for;

-- 5. 掌握度（理论门槛演示：一个已掌握、一个学习中）
INSERT INTO mastery_records
  (id, school_id, student_user_id, plan_id, objective_id, knowledge_type, status,
   mastery_basis_points, threshold_basis_points, qualitative_mastered,
   consecutive_correct, consecutive_wrong, interval_index, next_review_at,
   difficulty_basis_points, stability_basis_points, retrievability_basis_points,
   desired_retention_basis_points, review_count, lapse_count, created_at, updated_at)
VALUES
  (
    'mr-demo-var', 'school-demo', 'student-demo', 'plan-demo-python', 'lo-demo-var', 'memory', 'mastered',
    9200, 9000, false, 3, 0, 2, NOW() + interval '3 day',
    3000, 6000, 9000, 9000, 3, 0, NOW(), NOW()
  ),
  (
    'mr-demo-io', 'school-demo', 'student-demo', 'plan-demo-python', 'lo-demo-io', 'procedure', 'learning',
    6500, 9000, false, 1, 1, 0, NOW() + interval '1 day',
    4500, 3000, 7000, 9000, 2, 1, NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status, mastery_basis_points = EXCLUDED.mastery_basis_points,
  qualitative_mastered = EXCLUDED.qualitative_mastered,
  consecutive_correct = EXCLUDED.consecutive_correct,
  consecutive_wrong = EXCLUDED.consecutive_wrong,
  interval_index = EXCLUDED.interval_index, next_review_at = EXCLUDED.next_review_at,
  review_count = EXCLUDED.review_count, lapse_count = EXCLUDED.lapse_count,
  updated_at = NOW();

INSERT INTO mastery_attempts
  (id, school_id, student_user_id, objective_id, plan_id, question_id, result, is_correct,
   assessment_type, error_type, hints_used, attempt_count, quality_basis_points, user_answer, created_at)
VALUES
  ('ma-demo-var-1', 'school-demo', 'student-demo', 'lo-demo-var', 'plan-demo-python', 'q-var-1', 'correct', true,
   'quiz', NULL, 0, 1, 9500, '变量用来保存数据', NOW() - interval '2 day'),
  ('ma-demo-io-1', 'school-demo', 'student-demo', 'lo-demo-io', 'plan-demo-python', 'q-io-1', 'incorrect', false,
   'quiz', 'syntax', 1, 1, 3000, 'print input()', NOW() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- 6. 成长记录（服务端生成；学生私密可见）
INSERT INTO growth_records
  (id, school_id, student_user_id, project_id, type, occurred_at, title,
   summary_student, summary_parent, stage, artifact_ref, objective_titles, evidence_refs,
   source, visibility, idempotency_key, created_at)
VALUES
  (
    'gr-demo-plan-confirmed', 'school-demo', 'student-demo', NULL, 'plan_confirmed', NOW() - interval '3 day',
    '确认了 8 周 Python 小游戏计划',
    '我把想做的游戏写清楚，并确认了每周要完成什么。',
    '学生确认了 8 周学习计划，目标是自己完成并讲解一个小游戏。',
    'exploration', NULL, '["变量与类型","输入与输出"]'::jsonb, '["learningPlan:plan-demo-python"]'::jsonb,
    'server', 'student_private', 'seed:growth:plan-confirmed', NOW()
  ),
  (
    'gr-demo-theory-milestone', 'school-demo', 'student-demo', NULL, 'theory_milestone', NOW() - interval '1 day',
    '通过了「变量与类型」理论检查',
    '我能用自己的话解释变量，并连续答对了 3 题。',
    '学生在「变量与类型」达到掌握门槛（9200/9000）。',
    'theory', NULL, '["变量与类型"]'::jsonb, '["masteryRecord:mr-demo-var"]'::jsonb,
    'server', 'student_private', 'seed:growth:theory-milestone', NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type, title = EXCLUDED.title,
  summary_student = EXCLUDED.summary_student, summary_parent = EXCLUDED.summary_parent,
  objective_titles = EXCLUDED.objective_titles, evidence_refs = EXCLUDED.evidence_refs;

-- 7. 学生长期记忆（学生私密；AI 搭档只读候选）
INSERT INTO student_memories
  (id, school_id, student_user_id, partner_id, kind, content, confidence_basis_points,
   source, visibility, idempotency_key, created_at, updated_at)
VALUES
  (
    'sm-demo-interest', 'school-demo', 'student-demo', 'qitu-learning-partner', 'interest',
    '喜欢把编程和游戏结合，愿意花时间调试自己的小游戏。', 700,
    'conversation', 'student_private', 'seed:memory:interest', NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  kind = EXCLUDED.kind, content = EXCLUDED.content,
  confidence_basis_points = EXCLUDED.confidence_basis_points,
  visibility = EXCLUDED.visibility, updated_at = NOW();

-- 8. 班主任评审（待处理请求）
INSERT INTO mentor_reviews
  (id, school_id, student_user_id, mentor_user_id, project_id, artifact_ref, kind, status,
   decision, comment, idempotency_key, requested_at, reviewed_at, created_at, updated_at)
VALUES
  (
    'mrv-demo-python', 'school-demo', 'student-demo', 'teacher-demo', NULL, NULL, 'project', 'requested',
    NULL, NULL, 'seed:mentor-review:python', NOW(), NULL, NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status, comment = EXCLUDED.comment, updated_at = NOW();

-- 9. 正式项目（由已确认计划派生；用于演示作品与项目证据；仍在进行中）
INSERT INTO projects
  (id, student_user_id, template_version_id, source_exploration_id, status,
   current_stage_index, stage_total, progress_percent, title, subtitle, tags,
   created_at, completed_at)
VALUES
  (
    'project-demo-python', 'student-demo', 'ptv-python-mini-v1', NULL, 'practice',
    1, 4, 35, '猜数字小游戏', '把兴趣做成能讲解的小作品',
    '["python","游戏","演示"]'::jsonb, NOW() - interval '2 day', NULL
  )
ON CONFLICT (id) DO UPDATE SET
  template_version_id = EXCLUDED.template_version_id,
  status = EXCLUDED.status,
  current_stage_index = EXCLUDED.current_stage_index,
  stage_total = EXCLUDED.stage_total,
  progress_percent = EXCLUDED.progress_percent,
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  tags = EXCLUDED.tags;

-- Tutor UI 的历史演示项目 id，保留为同一学生的兼容别名，满足 tutor_sessions 外键。
INSERT INTO projects
  (id, student_user_id, template_version_id, source_exploration_id, status,
   current_stage_index, stage_total, progress_percent, title, subtitle, tags,
   created_at, completed_at)
VALUES
  (
    'project-demo-001', 'student-demo', 'ptv-python-mini-v1', NULL, 'reflection',
    2, 4, 40, '校园植物观察手册', '把观察变成可以分享的作品',
    '["植物","观察","演示"]'::jsonb, NOW() - interval '2 day', NULL
  )
ON CONFLICT (id) DO UPDATE SET
  template_version_id = EXCLUDED.template_version_id,
  status = EXCLUDED.status,
  current_stage_index = EXCLUDED.current_stage_index,
  stage_total = EXCLUDED.stage_total,
  progress_percent = EXCLUDED.progress_percent,
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  tags = EXCLUDED.tags;

-- 计划与正式项目互链；仅当计划尚无项目时写入，保持幂等（已有用户修改不覆盖）
UPDATE learning_plans
SET project_id = 'project-demo-python', updated_at = NOW()
WHERE id = 'plan-demo-python' AND project_id IS NULL;

-- 10. 作品 + 版本历程（草稿，学生私密；对象存储引用不含凭据）
INSERT INTO artifacts
  (id, school_id, student_user_id, project_id, template_version_id, title, summary,
   status, visibility, current_version_index, tags, idempotency_key, published_at, created_at, updated_at)
VALUES
  (
    'art-demo-python', 'school-demo', 'student-demo', 'project-demo-python', 'ptv-python-mini-v1',
    '猜数字小游戏（草稿）', '第一版可运行的程序，还在根据试玩反馈修改。',
    'draft', 'student_private', 2, '["python","游戏"]'::jsonb,
    'seed:artifact:python-mini', NULL, NOW() - interval '1 day', NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, summary = EXCLUDED.summary, status = EXCLUDED.status,
  visibility = EXCLUDED.visibility, current_version_index = EXCLUDED.current_version_index,
  tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO artifact_versions
  (id, artifact_id, ordinal, title, note, object_key, thumbnail_ref, captured_at, created_at)
VALUES
  (
    'artv-demo-python-1', 'art-demo-python', 1, '想法稿', '画出游戏界面和猜测流程。',
    'seed/artifacts/python-mini/v1.txt', NULL, NOW() - interval '2 day', NOW()
  ),
  (
    'artv-demo-python-2', 'art-demo-python', 2, '第一次原型', '可运行，但输入还没有校验。',
    'seed/artifacts/python-mini/v2.txt', NULL, NOW() - interval '1 day', NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, note = EXCLUDED.note, object_key = EXCLUDED.object_key,
  thumbnail_ref = EXCLUDED.thumbnail_ref, captured_at = EXCLUDED.captured_at;

-- 11. 项目证据（服务端聚合、只读；学生/客户端不能直接 POST）
INSERT INTO project_evidence
  (id, school_id, project_id, student_user_id, artifact_id, column_kind, source_kind,
   source_id, label, detail, occurred_at, created_at)
VALUES
  (
    'pe-demo-independent', 'school-demo', 'project-demo-python', 'student-demo', NULL,
    'independent', 'task_submission', 'task-demo-input-check',
    '自己完成输入校验', '在没有提示的情况下补上非数字输入处理。',
    NOW() - interval '1 day', NOW()
  ),
  (
    'pe-demo-ai-helped', 'school-demo', 'project-demo-python', 'student-demo', NULL,
    'ai_helped', 'tutor_turn', 'turn-demo-hint-loop',
    'AI 提示循环边界', '在提示等级 3 下定位到循环结束条件。',
    NOW() - interval '2 day', NOW()
  ),
  (
    'pe-demo-difficulty', 'school-demo', 'project-demo-python', 'student-demo', NULL,
    'difficulty', 'escalation_event', 'esc-demo-debug',
    '调试时卡住', '变量作用域理解偏差，已由班主任介入。',
    NOW() - interval '2 day', NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, detail = EXCLUDED.detail, occurred_at = EXCLUDED.occurred_at;

-- 12. 模板验证报告（不可变；demo 无已完成项目 → 检查未通过；证据由服务端另行写入）
INSERT INTO template_verification_runs
  (id, school_id, template_version_id, passed, checks, evidence_refs, evidence_count,
   evaluated_by, idempotency_key, evaluated_at, created_at)
VALUES
  (
    'tvr-demo-python-v1', NULL, 'ptv-python-mini-v1', false,
    '[{"key":"project_completed","label":"项目完成","passed":false,"detail":"已完成项目 0 个"},{"key":"theory_mastered","label":"理论掌握","passed":false,"detail":"已掌握 0/0 个目标"},{"key":"practice_mastered","label":"实践掌握","passed":false,"detail":"已掌握 0/0 个目标"},{"key":"artifact_accepted","label":"作品通过","passed":false,"detail":"通过复核的作品 0 件"},{"key":"mentor_approved","label":"班主任复核通过","passed":false,"detail":"项目复核通过 0 次"}]'::jsonb,
    '[]'::jsonb, 0, 'admin-demo', 'seed:verification:python-mini-v1',
    NOW() - interval '1 day', NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  passed = EXCLUDED.passed, checks = EXCLUDED.checks, evidence_refs = EXCLUDED.evidence_refs,
  evidence_count = EXCLUDED.evidence_count, evaluated_at = EXCLUDED.evaluated_at;

-- 13. 待答题（跨轮持久；expected_answer / explanation 绝不下发客户端）
INSERT INTO pending_questions
  (id, school_id, student_user_id, plan_id, session_id, objective_id, question_type,
   prompt, options, expected_answer, explanation, difficulty, assessment_type, status,
   attempt, hints_used, idempotency_key, asked_at, answered_at, created_at, updated_at)
VALUES
  (
    'pq-demo-input-guard', 'school-demo', 'student-demo', 'plan-demo-python', 'ls-demo-1',
    'lo-demo-io', 'short', '输入一个非数字时，程序会发生什么？你会怎么处理？',
    '[]'::jsonb,
    '会抛出 ValueError；应先用 try/except 或字符串判断，再提示重新输入。',
    '程序需要处理用户输入不是数字的情况，否则会中断。',
    'medium', 'quiz', 'awaiting', 1, 0,
    'seed:pending-question:input-guard', NOW(), NULL, NOW(), NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  prompt = EXCLUDED.prompt, options = EXCLUDED.options,
  expected_answer = EXCLUDED.expected_answer, explanation = EXCLUDED.explanation,
  difficulty = EXCLUDED.difficulty, status = EXCLUDED.status, updated_at = NOW();

COMMIT;
