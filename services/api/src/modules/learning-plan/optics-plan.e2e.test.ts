import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { findQuizBankEntry, toQuizBlockProjection } from '@qitu/ai-client/quiz-bank';
import type { CurrentUser, LearningPlanView } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import type { AccessPolicy } from '../../common/access/access-policy';
import type { OutboxEventInput } from '../../common/outbox/outbox.types';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { MasteryReadService } from '../mastery/mastery.service';
import { InMemoryTutorQuizStore } from '../ai-tutor/tutor-quiz.store';
import { TutorQuizService } from '../ai-tutor/tutor-quiz.service';
import type { TutorSessionRecord } from '../ai-tutor/tutor.service';
import type { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import { InMemoryTemplateEvidenceSource, InMemoryTemplateViewerDirectory } from '../templates/template-evidence.store';
import { InMemoryTemplateVerificationStore } from '../templates/template-verification.store';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { InMemoryTemplateBindingStore } from '../templates/templates-binding.store';
import {
  type TeamVersionRecord,
} from '../templates/templates-binding.types';
import { TemplateGovernanceService } from '../templates/templates-governance.service';
import { InMemoryTemplateStore } from '../templates/templates.store';
import { actor, FakeAuditWriter, FakeIdempotencyStore } from '../templates/templates.test-support';
import {
  runOpticsTemplateBootstrap,
  type OpticsBootstrapReport,
} from '../../scripts/optics-template-bootstrap';
import { InMemoryLearningPlanStore } from './learning-plan.store';
import { LearningPlanService } from './learning-plan.service';
import { DeterministicPlanGenerator } from './plan-generator';

const ADMIN = actor('admin', 'admin-1');
const STUDENT = actor('student', 'student-1');
const TEAM_VERSION_ID = 'tv-optics-1';
const NOW = new Date('2025-01-01T00:00:00Z');

/** 每个门禁承载目标对应的「规范概念键」题库条目（非旧别名）。 */
const GATED_QUIZ_BY_OBJECTIVE: Readonly<Record<string, string>> = {
  'opt-theory-reflection': 'optics.reflection.q2',
  'opt-theory-refraction': 'optics.refraction.q2',
  'opt-theory-tir': 'optics.tir.q1',
  'opt-theory-lens': 'optics.lens.q2',
};

/** 每个门禁承载目标 → 题库规范 conceptId（= knowledgePointId）。 */
const GATED_CONCEPT_BY_OBJECTIVE: Readonly<Record<string, string>> = {
  'opt-theory-reflection': 'optics.reflection.law',
  'opt-theory-refraction': 'optics.refraction.law',
  'opt-theory-tir': 'optics.tir.critical_angle',
  'opt-theory-lens': 'optics.lens.ray_rules',
  'opt-practice-diffraction': 'optics.wave.diffraction',
  'opt-practice-scattering': 'optics.wave.scattering',
};

class FakeOutboxWriter {
  readonly events: OutboxEventInput[] = [];

  async write(event: OutboxEventInput): Promise<string> {
    this.events.push(event);
    return event.id;
  }

  async markPublished(): Promise<void> {}

  async markFailed(): Promise<void> {}
}

class FakeAccessPolicy {
  async canReadStudent(actor: CurrentUser, studentId: string): Promise<boolean> {
    return actor.role === 'student' && actor.id === studentId;
  }
}

class FakeTeamRuntime {
  readonly calls: Array<{ studentUserId: string; gate: string; evidenceRef: string; source: string }> = [];

  async recordGateForStudent(input: {
    studentUserId: string;
    gate: string;
    evidenceRef: string;
    source: string;
  }): Promise<{ status: 'recorded' | 'already_satisfied' | 'deferred'; runId: string | null; gate: string }> {
    this.calls.push({ ...input });
    return { status: 'recorded', runId: null, gate: input.gate };
  }
}

function validTeamVersion(
  id: string,
  overrides: Partial<TeamVersionRecord> = {},
): TeamVersionRecord {
  return {
    id,
    teamId: 'team-optics',
    version: 1,
    name: '光学探究团队',
    description: 'A 组',
    workspaceMode: 'shared',
    sessionMode: 'auto',
    leaderAssistantId: 'optics-concept-coach',
    members: [{ userId: STUDENT.id }],
    pblSpec: {
      phases: ['exploration', 'concept_mastery', 'guided_practice', 'deliverable_review'],
    },
    enabled: true,
    createdBy: ADMIN.id,
    createdAt: NOW,
    ...overrides,
  };
}

interface Harness {
  plans: LearningPlanService;
  quiz: TutorQuizService;
  store: InMemoryLearningPlanStore;
  templates: InMemoryTemplateStore;
  governance: TemplateGovernanceService;
  bindings: TemplateBindingService;
  bindingStore: InMemoryTemplateBindingStore;
  idempotency: FakeIdempotencyStore;
  audit: FakeAuditWriter;
  outbox: FakeOutboxWriter;
  teamRuntime: FakeTeamRuntime;
}

async function seedOpticsBinding(
  templates: InMemoryTemplateStore,
  bindings: TemplateBindingService,
  bindingStore: InMemoryTemplateBindingStore,
  governance: TemplateGovernanceService,
): Promise<OpticsBootstrapReport> {
  bindingStore.seedTeamVersion(validTeamVersion(TEAM_VERSION_ID));
  return runOpticsTemplateBootstrap(
    {
      governance,
      bindings,
      templates,
      bindingStore,
    },
    { teamVersionId: TEAM_VERSION_ID, actor: ADMIN, pilotReason: 'test pilot' },
  );
}

function makeHarness(): Harness {
  const store = new InMemoryLearningPlanStore();
  const templates = new InMemoryTemplateStore();
  const evidence = new InMemoryTemplateEvidenceSource();
  const verification = new InMemoryTemplateVerificationStore();
  const directory = new InMemoryTemplateViewerDirectory();
  const bindingStore = new InMemoryTemplateBindingStore();
  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const outbox = new FakeOutboxWriter();
  const access = new FakeAccessPolicy();
  const teamRuntime = new FakeTeamRuntime();

  const governance = new TemplateGovernanceService(
    templates,
    evidence,
    verification,
    directory,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
  );
  const bindings = new TemplateBindingService(
    templates,
    directory,
    bindingStore,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
  );

  const mastery = new MasteryDomainService(
    store,
    new MasteryReadService(store, access as unknown as AccessPolicy),
    access as unknown as AccessPolicy,
    audit as unknown as AuditWriter,
    outbox as unknown as OutboxWriter,
  );

  const plans = new LearningPlanService(
    store,
    new DeterministicPlanGenerator(),
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
    outbox as unknown as OutboxWriter,
    access as unknown as AccessPolicy,
    mastery,
    teamRuntime as unknown as TeamRuntimeService,
    bindings,
  );

  const quiz = new TutorQuizService(
    store,
    new InMemoryTutorQuizStore(),
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
    plans,
    mastery,
  );

  return { plans, quiz, store, templates, governance, bindings, bindingStore, idempotency, audit, outbox, teamRuntime };
}

function flattenObjectives(plan: LearningPlanView): LearningPlanView['modules'][number]['objectives'] {
  return plan.modules.flatMap((module) => module.objectives);
}

function makeTutorSession(projectId: string): TutorSessionRecord {
  return {
    sessionId: 'session-optics-e2e',
    ownerId: STUDENT.id,
    projectId,
    source: 'project',
    createdAt: NOW.toISOString(),
    lastSeq: 0,
    turns: [],
    lastHintLevel: null,
    stallCount: 0,
    escalated: false,
  };
}

/** 把一条题库条目按「服务端权威投影」注入会话（`expectedKeys` 等私密字段不外泄）。 */
function emitQuiz(session: TutorSessionRecord, quizId: string): void {
  const entry = findQuizBankEntry(quizId);
  assert.ok(entry !== null, `题库条目 ${quizId} 存在`);
  const seq = session.lastSeq + 1;
  session.turns.push({
    turnId: `${session.sessionId}:assistant:${seq}`,
    role: 'assistant',
    blocks: [toQuizBlockProjection(entry)],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq,
    createdAt: NOW.toISOString(),
    modality: 'text',
    author: { id: 'optics-concept-coach', name: '概念教练', role: '导师' },
    pedagogicMove: 'hint',
    expectedEvidence: null,
    promptVersion: null,
    evidenceRef: null,
  });
  session.lastSeq = seq;
}

describe('光学课程驱动计划 E2E（生成 → 确认 → 概念键掌握 → TheoryMastered → 实践解锁）', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it('生成光学课程计划：模板版本来自生效绑定，14 个目标带概念键，4 周 8 节', async () => {
    const report = await seedOpticsBinding(
      h.templates,
      h.bindings,
      h.bindingStore,
      h.governance,
    );

    const generated = await h.plans.generatePlan(STUDENT, {
      interest: '光学',
      weeks: 4,
      curriculumSlug: 'optics-physical-inquiry',
    });

    assert.equal(generated.deduplicated, false);
    assert.equal(generated.plan.templateVersion, report.versionId, 'templateVersion 使用解析出的版本 id');

    const objectives = flattenObjectives(generated.plan);
    assert.equal(objectives.length, 14, '14 个真实光学目标');
    assert.equal(generated.plan.modules.length, 4, '4 个周模块');

    const expectedOrder = [
      'opt-intent-observe',
      'opt-intent-question',
      'opt-theory-reflection',
      'opt-theory-refraction',
      'opt-theory-tir',
      'opt-theory-lens',
      'opt-practice-setup',
      'opt-practice-measure',
      'opt-practice-fit',
      'opt-practice-report',
      'opt-practice-diffraction',
      'opt-practice-scattering',
      'opt-review-defend',
      'opt-review-reflect',
    ];
    assert.deepEqual(
      objectives.map((objective) => objective.id.split(':').pop()),
      expectedOrder,
      '目标顺序与内容排课一致',
    );

    for (const objective of objectives) {
      const rawId = objective.id.split(':').pop() ?? objective.id;
      const expectedConceptId = GATED_CONCEPT_BY_OBJECTIVE[rawId];
      if (expectedConceptId === undefined) {
        assert.equal(objective.conceptId, undefined, `非门禁目标 ${rawId} 不投影 conceptId`);
      } else {
        assert.equal(objective.conceptId, expectedConceptId, `有显式知识键的目标 ${rawId} 投影 conceptId`);
      }
    }
  });

  it('解析不到生效绑定时响亮失败（CURRICULUM_TEMPLATE_UNAVAILABLE），不静默回退', async () => {
    await assert.rejects(
      h.plans.generatePlan(STUDENT, {
        interest: '光学',
        weeks: 4,
        curriculumSlug: 'optics-physical-inquiry',
      }),
      (error: unknown) => {
        const http = error as { getStatus?: () => number; getResponse?: () => unknown };
        assert.equal(http.getStatus?.(), 400);
        const response = http.getResponse?.() as { code?: string } | undefined;
        assert.equal(response?.code, 'CURRICULUM_TEMPLATE_UNAVAILABLE');
        return true;
      },
    );
  });

  it('通用计划保持 obj-t-* / local: 映射与视图省略 conceptId', async () => {
    const generated = await h.plans.generatePlan(STUDENT, {
      interest: '机器人',
      weeks: 4,
    });

    const objectives = flattenObjectives(generated.plan);
    assert.ok(objectives.length > 0, '通用计划仍有目标');
    assert.ok(
      objectives.some((objective) => objective.id.split(':').pop()?.startsWith('obj-t-')),
      '通用计划仍生成 obj-t-* 理论目标',
    );
    for (const objective of objectives) {
      assert.equal(objective.conceptId, undefined, '通用计划不投影 conceptId');
    }

    const theoryObjective = objectives.find((objective) => objective.id.split(':').pop()?.startsWith('obj-t-'));
    assert.ok(theoryObjective !== undefined);
    const mapping = await h.store.findObjectiveMapping({
      planId: generated.plan.id,
      objectiveId: theoryObjective.id,
      templateVersion: generated.plan.templateVersion,
      contentVersion: generated.plan.templateVersion,
    });
    assert.equal(mapping?.knowledgePointId, `local:${theoryObjective.id}`, '通用映射仍是 local: 键');
  });

  it('判分经 mastery_objective_mappings 解析概念键，逐题三次达标后 TheoryMastered 门禁记录、实践解锁', async () => {
    const report = await seedOpticsBinding(
      h.templates,
      h.bindings,
      h.bindingStore,
      h.governance,
    );

    const generated = await h.plans.generatePlan(STUDENT, {
      interest: '光学',
      weeks: 4,
      curriculumSlug: 'optics-physical-inquiry',
    });
    assert.equal(generated.plan.templateVersion, report.versionId);

    const confirmed = await h.plans.confirmPlan(STUDENT, generated.plan.id, 'confirm-optics', {});
    assert.ok(confirmed.project.id.startsWith('proj-'), '确认后创建项目');

    const beforeGateSessions = await h.plans.listSessions(STUDENT, generated.plan.id);
    const lockedPracticeSessions = beforeGateSessions.filter((item) => item.practiceObjectiveIds.length > 0);
    assert.ok(lockedPracticeSessions.length > 0, '理论门禁前存在待解锁的实践会话');
    assert.equal(
      lockedPracticeSessions.every((item) => !item.practiceUnlocked),
      true,
      'TheoryMastered 前实践会话保持锁定',
    );

    const session = makeTutorSession(confirmed.project.id);

    for (const objectiveId of Object.keys(GATED_QUIZ_BY_OBJECTIVE)) {
      const quizId = GATED_QUIZ_BY_OBJECTIVE[objectiveId] as string;
      const conceptId = GATED_CONCEPT_BY_OBJECTIVE[objectiveId] as string;
      const entry = findQuizBankEntry(quizId);
      assert.ok(entry !== null);
      emitQuiz(session, quizId);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await h.quiz.answer(
          STUDENT,
          session,
          quizId,
          {
            selectedKeys: [...entry.expectedKeys],
            idempotencyKey: `grade-${objectiveId}-${attempt}`,
          },
          `grade-${objectiveId}-${attempt}`,
        );
        assert.equal(result.correct, true, `${objectiveId} 第 ${attempt} 次作答正确`);
        if (attempt === 3) {
          const delta = result.conceptDeltas.find((item) => item.conceptId === conceptId);
          assert.ok(delta !== undefined, `${objectiveId} 第三次作答产生概念增量`);
          assert.equal(delta.mastered, true, `${objectiveId} 第三次作答后达标`);
        }
      }

      const mastery = await h.store.findMastery(STUDENT.id, `${generated.plan.id}:${objectiveId}`);
      assert.ok(mastery !== null, `${objectiveId} 掌握记录已写入`);
      assert.equal(mastery.knowledgePointId, conceptId, `${objectiveId} 掌握记录携带概念键`);
      assert.equal(mastery.masteryBasisPoints, 9000, `${objectiveId} 三连对后定量掌握 0.9`);

      const mapping = await h.store.findObjectiveMapping({
        planId: generated.plan.id,
        objectiveId: `${generated.plan.id}:${objectiveId}`,
        templateVersion: report.versionId,
        contentVersion: report.versionId,
      });
      assert.equal(mapping?.knowledgePointId, conceptId, `${objectiveId} 映射解析到概念键`);
    }

    const sessions = await h.plans.listSessions(STUDENT, generated.plan.id);
    const practiceSessions = sessions.filter((item) => item.practiceObjectiveIds.length > 0);
    assert.ok(practiceSessions.length > 0, '存在实践会话');
    for (const item of practiceSessions) {
      assert.equal(item.practiceUnlocked, true, `实践会话 ${item.id} 已解锁`);
    }
    const gateSession = sessions.find((item) => item.theoryObjectiveIds.length === 4);
    assert.ok(gateSession !== undefined, '存在承载完整门禁集合的会话');
    assert.equal(gateSession.theoryMastered, true, '门禁会话理论达标');

    const practiceObjectiveIds = new Set(
      practiceSessions.flatMap((item) => item.practiceObjectiveIds),
    );
    assert.equal(
      practiceObjectiveIds.has('opt-practice-diffraction'),
      true,
      'TheoryMastered 后实践会话包含衍射探究目标',
    );
    assert.equal(
      practiceObjectiveIds.has('opt-practice-scattering'),
      true,
      'TheoryMastered 后实践会话包含散射探究目标',
    );

    const theoryGates = h.teamRuntime.calls.filter((call) => call.gate === 'TheoryMastered');
    assert.equal(theoryGates.length, 1, 'TheoryMastered 门禁恰好记录一次');
    assert.equal(theoryGates[0]?.studentUserId, STUDENT.id);
  });
});
