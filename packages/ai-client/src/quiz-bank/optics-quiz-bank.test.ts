import {
  assertOpticsObjectiveTypePolicy,
  OPTICS_GATED_OBJECTIVE_IDS,
  OPTICS_LEGACY_CONCEPT_ALIASES,
  OPTICS_OBJECTIVES,
  OPTICS_THEORY_CONCEPTS,
  OPTICS_WAVE_INQUIRY_STEPS,
  OPTICS_WAVE_MODULES,
  opticsConceptExists,
} from './optics/index.js';
import { MISCONCEPTION_REMEDIATIONS, knownMisconceptionTag } from './optics/misconceptions.js';
import { QUIZ_BANK, toQuizBlockProjection } from './index.js';
import { THUNDER_QUIZ_BANK } from './thunder-fighter.js';
import { runOpticsCurriculumAssertions } from './optics/curriculum.test.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

/** 内容 / 题库 / 迷思库不变量断言，由 `pnpm --filter @qitu/ai-client test` 调用。 */
export function runOpticsQuizBankAssertions(): void {
  runOpticsCurriculumAssertions();
  /* ============================ 内容不变量 ============================ */

  // 4 个理论概念：memory ×3 + procedure ×1。
  equal(OPTICS_THEORY_CONCEPTS.length, 4, '理论概念应为 4 个');
  equal(
    OPTICS_THEORY_CONCEPTS.filter((concept) => concept.knowledgeType === 'memory').length,
    3,
    '理论概念 memory 应为 3 个',
  );
  equal(
    OPTICS_THEORY_CONCEPTS.filter((concept) => concept.knowledgeType === 'procedure').length,
    1,
    '理论概念 procedure 应为 1 个',
  );

  // 3 个波动模块：concept/design 质化，显式非门禁。
  equal(OPTICS_WAVE_MODULES.length, 4, 'wave modules should include scattering');
  equal(OPTICS_WAVE_INQUIRY_STEPS.length, 2, 'diffraction and scattering evidence prompts');
  for (const step of OPTICS_WAVE_INQUIRY_STEPS) {
    assert(OPTICS_WAVE_MODULES.some((module) => module.conceptId === step.conceptId), `${step.id} conceptId must exist`);
    equal(step.mode, 'simulation', `${step.id} must be simulation-only before the gate`);
    equal(step.physicalActivityGate, 'TheoryMastered', `${step.id} physical activity gate`);
    assert(step.expectedEvidence.length > 0, `${step.id} must define expected evidence`);
    assert(/virtual|simulated|simulation/iu.test(step.prompt), `${step.id} prompt must be explicitly virtual`);
    assert(/no physical|do not|not.*apparatus/iu.test(step.prompt), `${step.id} must prohibit pre-gate physical work`);
  }
  for (const module of OPTICS_WAVE_MODULES) {
    equal(module.gradingGated, false, `${module.moduleId} 必须标记非门禁`);
    assert(
      module.knowledgeType === 'concept' || module.knowledgeType === 'design',
      `${module.moduleId} 知识类型应为 concept|design`,
    );
  }

  // 旧键别名覆盖存量 3 条题库条目。
  deepEqual(
    Object.keys(OPTICS_LEGACY_CONCEPT_ALIASES).sort(),
    ['optics.lens', 'optics.reflection', 'optics.refraction'],
    '旧键别名应恰好覆盖存量 3 条',
  );

  // 门禁承载集合：恰为 concept_mastery 的 4 个理论目标，且全部 memory|procedure。
  equal(OPTICS_GATED_OBJECTIVE_IDS.length, 4, '门禁承载目标应为 4 个');
  for (const id of OPTICS_GATED_OBJECTIVE_IDS) {
    const objective = OPTICS_OBJECTIVES.find((item) => item.id === id);
    assert(objective !== undefined, `门禁目标 ${id} 存在`);
    assert(
      objective.knowledgeType === 'memory' || objective.knowledgeType === 'procedure',
      `门禁目标 ${id} knowledgeType 应为 memory|procedure`,
    );
  }

  // reflection 目标：knowledgeType null，且不在门禁集合。
  const reflection = OPTICS_OBJECTIVES.find((item) => item.kind === 'reflection');
  assert(reflection !== undefined, '存在 reflection 目标');
  equal(reflection.knowledgeType, null, 'reflection 目标 knowledgeType 应为 null');
  assert(!OPTICS_GATED_OBJECTIVE_IDS.includes(reflection.id), 'reflection 不得门禁承载');

  // 类型策略断言本身必须通过。
  try {
    assertOpticsObjectiveTypePolicy();
  } catch (error) {
    throw new Error(`目标树类型策略应通过，实际抛错：${(error as Error).message}`);
  }

  /* ============================ 题库不变量 ============================ */

  // 光学题保持 11 条；其他领域共享全局题号与答案投影约束。
  equal(QUIZ_BANK.filter(entry => entry.conceptId.startsWith('optics.')).length, 11, '光学题库应为 11 条');
  const ids = new Set(QUIZ_BANK.map((entry) => entry.questionId));
  equal(ids.size, QUIZ_BANK.length, '题号必须唯一');

  // 存量 3 条不被改动（题号 / conceptId / 答案键）。
  const legacy = {
    'optics.reflection.q1': { conceptId: 'optics.reflection', expectedKeys: ['B'] },
    'optics.refraction.q1': { conceptId: 'optics.refraction', expectedKeys: ['B'] },
    'optics.lens.q1': { conceptId: 'optics.lens', expectedKeys: ['C'] },
  };
  for (const [questionId, expected] of Object.entries(legacy)) {
    const entry = QUIZ_BANK.find((item) => item.questionId === questionId);
    assert(entry !== undefined, `存量条目 ${questionId} 存在`);
    equal(entry.conceptId, expected.conceptId, `${questionId} conceptId 不变`);
    deepEqual(entry.expectedKeys, expected.expectedKeys, `${questionId} 答案键不变`);
  }

  // 每条：单选、≥3 选项、恰一个期望键、解析与引导非空、conceptId 内容层存在。
  for (const entry of QUIZ_BANK) {
    equal(entry.type, 'single', `${entry.questionId} 必须单选`);
    assert(entry.options.length >= 3, `${entry.questionId} 选项至少 3 个`);
    equal(entry.expectedKeys.length, 1, `${entry.questionId} 恰一个期望键`);
    assert(entry.explanation.length > 0, `${entry.questionId} 解析非空`);
    assert(entry.rationaleHint.length > 0, `${entry.questionId} 引导非空`);
    assert(
      THUNDER_QUIZ_BANK.some(question => question.conceptId === entry.conceptId) || opticsConceptExists(entry.conceptId),
      `${entry.questionId} 的 conceptId ${entry.conceptId} 必须在内容层存在`,
    );
    for (const key of entry.expectedKeys) {
      assert(
        entry.options.some((option) => option.key === key),
        `${entry.questionId} 期望键 ${key} 必须在选项中存在`,
      );
    }
  }

  // 新增 8 条的迷思字段与迷思库对齐，且不泄答案。
  for (const entry of QUIZ_BANK) {
    if (entry.misconceptionTag === undefined) continue;
    assert(
      knownMisconceptionTag(entry.misconceptionTag),
      `${entry.misconceptionTag} 必须在迷思库登记`,
    );
    const remediation = MISCONCEPTION_REMEDIATIONS.find(
      (item) => item.misconceptionTag === entry.misconceptionTag,
    );
    assert(remediation !== undefined, `${entry.misconceptionTag} 的迷思条目存在`);
    equal(remediation.conceptId, entry.conceptId, `${entry.questionId} 迷思概念与条目概念一致`);
    equal(entry.errorTypeCode, remediation.errorTypeCode, `${entry.questionId} errorTypeCode 对齐`);
  }

  /* ============================ 投影 / 泄露不变量 ============================ */

  for (const entry of QUIZ_BANK) {
    const projection = toQuizBlockProjection(entry);
    const forbidden = [
      'expectedKeys',
      'explanation',
      'rationaleHint',
      'misconceptionTag',
      'errorTypeCode',
    ];
    for (const key of forbidden) {
      assert(!(key in projection), `投影不得包含 ${key}（${entry.questionId}）`);
    }
    equal(projection.questionId, entry.questionId, `${entry.questionId} 投影 questionId`);
    deepEqual(
      projection.linkedConceptIds,
      [entry.conceptId],
      `${entry.questionId} 投影 linkedConceptIds`,
    );
  }

  /* ============================ 迷思库不变量 ============================ */

  const seenTags = new Set<string>();
  for (const remediation of MISCONCEPTION_REMEDIATIONS) {
    assert(!seenTags.has(remediation.misconceptionTag), '迷思标签唯一');
    seenTags.add(remediation.misconceptionTag);
    assert(remediation.socraticHint.length > 0, `${remediation.misconceptionTag} 提示非空`);
    assert(
      remediation.socraticHint.trim().endsWith('？'),
      `${remediation.misconceptionTag} 提示必须以问号收尾`,
    );
    assert(opticsConceptExists(remediation.conceptId), `${remediation.conceptId} 必须在内容层存在`);
  }
}
