import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OPTICS_16_SESSION_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { generatePlanFromTemplate } from './template-plan-generator';
import { validateGeneratedPlan } from './session-plan-validator';

const INPUT = { interest: '光与证据', weeks: 8 as const, goal: null, curriculumSlug: 'optics-physical-inquiry-16s', sessionCount: 16 as const };

describe('Template-owned plan projection', () => {
  it('projects canonical lesson-only schedules without week/day fields', () => {
    const plan = generatePlanFromTemplate({
      interest: '光与证据',
      lessonCount: 16,
      lessonMinutes: 60,
      goal: null,
      curriculumSlug: 'optics-physical-inquiry-16s',
      sessionCount: 16,
    }, { templateVersion: 'lesson-v2', templateSpec: OPTICS_16_SESSION_TEMPLATE_SPEC });
    validateGeneratedPlan(plan);
    assert.equal(plan.lessonCount, 16);
    assert.equal(plan.lessonMinutes, 60);
    assert.equal('weeks' in plan, false);
    assert.equal(plan.modules.length, 16);
    assert.deepEqual(plan.modules.map((module) => module.lessonIndex), Array.from({ length: 16 }, (_, i) => i + 1));
    assert.deepEqual(plan.sessions.map((session) => session.lessonIndex), Array.from({ length: 16 }, (_, i) => i + 1));
    for (const module of plan.modules) assert.equal('weekIndex' in module, false);
    for (const session of plan.sessions) {
      assert.equal('week' in session, false);
      assert.equal('day' in session, false);
    }
  });

  it('uses resolved session content, objective text and block minutes, not global constants', () => {
    const spec = structuredClone(OPTICS_16_SESSION_TEMPLATE_SPEC);
    const profile = spec.curriculum?.profiles[0];
    assert.ok(profile);
    const first = profile.sessions[0];
    assert.ok(first);
    const changed = { ...spec, objectives: spec.objectives.map((objective, index) => index === 0 ? { ...objective, title: 'Content-owned objective' } : objective),
      curriculum: { profiles: [{ ...profile, sessions: [{ ...first, title: 'Frozen lesson', learningGoal: 'Frozen learning goal',
        activityGuidance: { ...first.activityGuidance, theory: 'Frozen activity' }, evidenceRequirements: ['Frozen evidence'],
        blocks: { ...first.blocks, theory: 25, check: 20 } }, ...profile.sessions.slice(1)] }] } };
    const plan = generatePlanFromTemplate(INPUT, { templateVersion: 'resolved-version-16', templateSpec: changed });
    validateGeneratedPlan(plan);
    assert.equal(plan.templateVersion, 'resolved-version-16');
    assert.equal(plan.sessions[0]?.title, 'Frozen lesson');
    assert.equal(plan.sessions[0]?.blocks.find((block) => block.kind === 'theory')?.guidance, 'Frozen learning goal\nFrozen activity');
    assert.deepEqual(plan.sessions[0]?.blocks.find((block) => block.kind === 'reflect')?.evidenceRequirements,
      ['Frozen evidence']);
    assert.equal(plan.sessions[0]?.blocks.find((block) => block.kind === 'check')?.minutes, 20);
    assert.equal(plan.objectives[0]?.name, 'Content-owned objective');
    assert.equal(plan.sessions.length, 16);
    assert.equal(plan.objectives.length, 12);
    assert.deepEqual(plan.sessions[9]?.practiceObjectiveIds, ['opt-practice-measure']);
    for (const index of [7, 13, 15]) {
      const session = plan.sessions[index];
      assert.ok(session);
      for (const forbidden of ['theoryMastered', 'completed', 'artifactApproved', 'archived']) assert.equal(forbidden in session, false);
    }
  });

  it('projects the requested 16 lessons with all objectives covered and no wave theory gates', () => {
    const plan = generatePlanFromTemplate(INPUT, { templateVersion: 'version-16s', templateSpec: OPTICS_16_SESSION_TEMPLATE_SPEC });
    validateGeneratedPlan(plan);
    assert.deepEqual(plan.sessions.map((session) => session.title), [
      '光的宏观现象与观察指标', '提出探究假设与实验方案', '光的直线传播与平面镜成像原理', '反射定律公式与光路可逆性',
      '折射定律与介质折射率定义', '全反射发生条件与临界角推导', '凸透镜与凹透镜成像特殊光线作图', '理论综合闯关与门禁评测',
      '光具座搭建、法线与光轴校准', '折射角与物像距数据采集', '单缝衍射现象与条纹特征探究', '封闭细雾室介质散射探究',
      '数据线性化拟合与实验求参', '实验报告撰写与 CER 科学论证', '实验探究成果答辩与同行质疑', '学习反思与学科素养成长归档',
    ]);
    assert.deepEqual(plan.sessions.map((session) => [session.week, session.day]),
      Array.from({ length: 16 }, (_, index) => [Math.floor(index / 2) + 1, index % 2 + 1]));
    const covered = new Set(plan.sessions.flatMap((session) => session.blocks.flatMap((block) => block.objectiveIds)));
    assert.equal(covered.size, 12);
    for (const objective of plan.objectives) assert.ok(covered.has(objective.id));
    for (const session of plan.sessions) {
      assert.equal(session.blocks.reduce((sum, block) => sum + block.minutes, 0), 60);
      for (const block of session.blocks) assert.ok(block.guidance?.trim());
      assert.equal(session.blocks.find((block) => block.kind === 'reflect')?.evidenceRequirements?.length, 2);
    }
    assert.deepEqual(plan.sessions[9]?.practiceObjectiveIds, ['opt-practice-measure']);
    for (const session of plan.sessions.slice(8, 14)) assert.deepEqual(session.theoryObjectiveIds,
      ['opt-theory-reflection', 'opt-theory-refraction', 'opt-theory-tir', 'opt-theory-lens']);
    assert.match(plan.sessions[5]?.blocks.find((block) => block.kind === 'theory')?.guidance ?? '', /sin C = n_2\/n_1/);
    assert.match(plan.sessions[12]?.blocks.find((block) => block.kind === 'theory')?.guidance ?? '', /1\/v = -1\/u \+ 1\/f/);
    assert.match(plan.objectives.find((objective) => objective.id === 'opt-practice-fit')?.objective ?? '', /符号约定/);
  });

  it('rejects unavailable or ambiguous profiles and malformed template content instead of fallback', () => {
    assert.throws(() => generatePlanFromTemplate({ ...INPUT, weeks: 4 }, { templateVersion: 'v2', templateSpec: OPTICS_16_SESSION_TEMPLATE_SPEC }));
    assert.throws(() => generatePlanFromTemplate(INPUT, { templateVersion: 'v2', templateSpec: undefined }));
    const spec = OPTICS_16_SESSION_TEMPLATE_SPEC;
    const profile = spec.curriculum?.profiles[0];
    assert.ok(profile);
    assert.throws(() => generatePlanFromTemplate(INPUT, { templateVersion: 'v2', templateSpec: { ...spec, curriculum: undefined } }));
    assert.throws(() => generatePlanFromTemplate(INPUT, { templateVersion: 'v2', templateSpec: { ...spec, curriculum: { profiles: [profile, { ...profile, id: 'other-profile' }] } } }));
  });
});
