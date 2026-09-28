-- AI 搭档工作区的可重复初始化数据。
-- 不包含任何学生原始对话、密钥或个人信息。
INSERT INTO tutor_partners (id, display_name, soul, model_usage, prompt_version, capabilities)
VALUES (
  'qitu-learning-partner',
  '启途学习搭档',
  '用一个问题打开好奇心，用一个小行动让学习变得可见。',
  'tutor.chat',
  'qitu.partner.v1',
  '["explore", "plan", "teach", "review", "reflect"]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  soul = EXCLUDED.soul,
  model_usage = EXCLUDED.model_usage,
  prompt_version = EXCLUDED.prompt_version,
  capabilities = EXCLUDED.capabilities,
  updated_at = now();

INSERT INTO tutor_template_documents (id, version, title, summary, tags, stage, content, scope, active)
VALUES
  (
    'template-python-mini-project-v1',
    'v1',
    'Python 小项目：从兴趣到作品',
    '把一个喜欢的主题拆成探索、理论、实践和展示四个阶段。',
    '["Python", "编程", "项目", "作品"]'::jsonb,
    'exploration',
    '先确认兴趣和目标作品，再生成 4 周或 8 周学习计划；每次学习先完成理论检查，TheoryMastered 后才解锁实践。',
    'system',
    true
  ),
  (
    'template-story-game-v1',
    'v1',
    '故事游戏创作模板',
    '用角色、规则和反馈循环做一个可玩的互动故事。',
    '["游戏", "故事", "创作", "设计"]'::jsonb,
    'exploration',
    '从孩子喜欢的角色或故事出发，先画出规则和分支，再制作最小可玩版本，最后通过试玩反馈迭代。',
    'system',
    true
  )
ON CONFLICT (id) DO UPDATE SET
  version = EXCLUDED.version,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  tags = EXCLUDED.tags,
  stage = EXCLUDED.stage,
  content = EXCLUDED.content,
  active = EXCLUDED.active,
  updated_at = now();

INSERT INTO tutor_knowledge_documents (id, version, title, summary, tags, content, source, scope, active)
VALUES
  (
    'knowledge-socratic-project-loop-v1',
    'v1',
    '项目式学习对话原则',
    '每次只推进一个可观察的小目标，用问题、证据和反思帮助学生形成自己的判断。',
    '["苏格拉底式", "项目式学习", "反思"]'::jsonb,
    '对话先确认学生想做什么，再询问已有尝试和不确定点。AI 不替学生完成决策，不直接写入成长档案；每个结论都要能关联到学生自己的回答、作品或反思。',
    'qitu-core-learning-principles',
    'system',
    true
  ),
  (
    'knowledge-theory-before-practice-v1',
    'v1',
    '理论掌握到实践解锁',
    '实践任务必须建立在服务端确认的理论掌握之上。',
    '["TheoryMastered", "掌握度", "实践"]'::jsonb,
    '理论目标用服务端题目和反思检查；一次答对不足以通过掌握门槛。只有服务端产生 TheoryMastered 后，实践目标才可以开始。',
    'qitu-curriculum-policy',
    'system',
    true
  )
ON CONFLICT (id) DO UPDATE SET
  version = EXCLUDED.version,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  tags = EXCLUDED.tags,
  content = EXCLUDED.content,
  source = EXCLUDED.source,
  active = EXCLUDED.active,
  updated_at = now();
