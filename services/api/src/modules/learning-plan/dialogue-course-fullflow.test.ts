import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProjectTemplateSpec } from '@qitu/contracts';
import { WAVE_DIALOGUE_TEMPLATE_SPEC, WAVE_TEACHING_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { fullflowHarness, STUDENT } from './optics-fullflow.test-fixture';
import { explicitLearningHelp, normalizePresentedAnswer, TutorLearningReplyService, type LearningReplyInterpreter } from '../ai-tutor/tutor-learning-reply.service';
import type { TutorSessionRecord } from '../ai-tutor/tutor.service';
import { reviewDialogueAnswer } from './dialogue-answer-review';
import type { PlanBundle, PendingQuestionRecord } from './learning-plan.store';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { LessonQualityEvaluator } from '../works/lesson-quality-evaluator';

test('dialogue contract is opt-in, keeps necessary theory and permits final delivery only', () => {
  assert.equal(validateProjectTemplateSpec(WAVE_DIALOGUE_TEMPLATE_SPEC).valid, true);
  assert.equal(validateProjectTemplateSpec(WAVE_TEACHING_TEMPLATE_SPEC).valid, true);
  const invalid = structuredClone(WAVE_DIALOGUE_TEMPLATE_SPEC);
  Object.assign(invalid, { lessonPolicy: 'lesson-guided.v1' });
  assert.equal(validateProjectTemplateSpec(invalid).valid, false);
  const early = structuredClone(WAVE_DIALOGUE_TEMPLATE_SPEC);
  Object.assign(early.curriculum!.profiles[0]!.sessions[0]!, { activityRequirements: [{ activity: 'check', evidence: 'submitted_artifact' }] });
  assert.equal(validateProjectTemplateSpec(early).valid, false);
  assert.equal(explicitLearningHelp('我不会，可以先给我一个提示吗？'), true);
  assert.equal(explicitLearningHelp('我原来不知道，现在明白同向波幅相加、反向相减，光强不会为负。'), false);
  assert.equal(explicitLearningHelp('同向相加，反向相减。不过我不明白光强为什么不会为负？'), false);
  assert.equal(normalizePresentedAnswer('选 A', [{ id: 'stable-a', label: 'A', body: '波幅同向相加' }]), 'stable-a');
  assert.equal(normalizePresentedAnswer('A 或 B', [{ id: 'stable-a', label: 'A', body: '波幅同向相加' }]), null);
});

test('a unique public option bypasses intent classification but keeps help, ambiguity and owner grading', async () => {
  const h = await fullflowHarness(true, true, true, true, false, undefined, true);
  let classify = true, calls = 0;
  const replies = new TutorLearningReplyService(h.store, h.plans, h.bindings, h.progress, h.learningEvidence, h.lifecycle,
    { isAnswer: async () => { calls++; return classify; } } as unknown as LearningReplyInterpreter, h.keys);
  const first = h.plan.sessions[0]!;
  await replies.accept(STUDENT, h.projectId, { planId: h.planId, planRevision: 1, learningSessionId: first.id,
    activityId: `${first.id}:activity:check`, questionId: null }, 'Compare single and double slit patterns.', 'start-inquiry');
  classify = false;
  const second = h.plan.sessions[1]!, scope = { planId: h.planId, planRevision: 1, learningSessionId: second.id };
  await h.assessment.start(STUDENT, h.projectId, scope);
  const pending = await h.store.findAwaitingQuestion(STUDENT.id, h.planId); assert.ok(pending);
  const answer = pending.options.find(option => option.id === pending.expectedAnswer || option.body === pending.expectedAnswer);
  assert.ok(answer, 'private oracle stays inside this disposable fixture');
  const replyScope = { ...scope, activityId: `${second.id}:activity:check`, questionId: pending.id };
  await replies.accept(STUDENT, h.projectId, replyScope, '我不会，请给我一个提示', 'choice-help');
  assert.equal((await h.store.findAwaitingQuestion(STUDENT.id, h.planId))?.id, pending.id);
  await replies.accept(STUDENT, h.projectId, replyScope, 'A 或 B', 'ambiguous-choice');
  assert.equal((await h.store.findAwaitingQuestion(STUDENT.id, h.planId))?.id, pending.id);
  const before = calls;
  const notice = await replies.accept(STUDENT, h.projectId, replyScope, answer.label.toLowerCase(), 'public-choice');
  assert.match(notice!, /回答正确/);
  assert.equal(calls, before, 'a recognized option does not depend on an unavailable or negative classifier');
  assert.ok((await h.store.findPendingQuestion(pending.id))?.answeredAt);
  assert.notEqual((await h.store.findAwaitingQuestion(STUDENT.id, h.planId))?.id, pending.id);
  const receipt = await replies.acceptWithReceipt(STUDENT, h.projectId, replyScope, answer.label.toLowerCase(), 'public-choice');
  assert.equal(receipt.kind, 'answer_recorded');
  await replies.accept(STUDENT, h.projectId, replyScope, answer.label.toLowerCase(), 'public-choice');
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 1, 'replay cannot complete theory');
});

test('eight lessons use dialogue and real observation owners; only final lesson publishes and archives', async () => {
  const h = await fullflowHarness(true, true, true, true, false, undefined, true);
  const version = await h.templates.findVersion(h.plan.plan.templateVersion); assert.ok(version);
  const binding = (await h.bindingStore.listBindings(version.id))[0]!;
  const team = await h.bindingStore.findTeamVersion(binding.teamVersionId, binding.id); assert.ok(team);
  const normalizedTeam = structuredClone(team);
  for (const phase of normalizedTeam.pblSpec.phases as Record<string, unknown>[]) if (phase.evidenceProfile === null) delete phase.evidenceProfile;
  await h.catalog.compile(version, normalizedTeam, binding.bundleDraft!);
  const conflictingTeam = structuredClone(team);
  (conflictingTeam.pblSpec.phases as { phase: string; gateCondition: string }[]).find(phase => phase.phase === 'guided_practice')!.gateCondition = 'experiment_report_validated';
  await assert.rejects(h.catalog.compile(version, conflictingTeam, binding.bundleDraft!), /教学配置编译未通过/);
  h.evaluation.advisoryMeets = false;
  const replies = new TutorLearningReplyService(h.store, h.plans, h.bindings, h.progress, h.learningEvidence, h.lifecycle,
    { isAnswer: async () => true } as unknown as LearningReplyInterpreter, h.keys);
  const profile = h.teaching.template.curriculum!.profiles[0]!;
  let serial = 0, observations = 0;
  for (const frozen of profile.sessions) {
    const session = h.plan.sessions[frozen.sessionIndex - 1]!;
    const scope = { planId: h.planId, planRevision: 1, learningSessionId: session.id };
    assert.equal((await h.progress.readProgress(STUDENT, h.planId)).currentSessionId, session.id);
    if (frozen.sessionIndex === 8) {
      assert.equal((await h.store.findProject(h.projectId))?.status, 'artifact_review');
      assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, 1)).approvedArtifacts.length, 0, 'final lesson is reachable before artifact approval');
    }
    for (let round = 0; (await h.progress.readProgress(STUDENT, h.planId)).currentSessionId === session.id; round++) {
      assert.ok(round < 15);
      const progress = await h.progress.readProgress(STUDENT, h.planId);
      const activity = progress.sessions.find(item => item.sessionId === session.id)!.activities!.find(item => item.status === 'current')!;
      assert.ok(activity);
      const replyScope = { ...scope, activityId: activity.activityId, questionId: null as string | null };
      const key = `dialogue-fixture-${serial++}`;
      if (activity.evidence === 'mastery') {
        const started = await h.assessment.start(STUDENT, h.projectId, scope);
        const pending = await h.store.findPendingQuestion(started.nextStep!.question!.questionId); assert.ok(pending);
        replyScope.questionId = pending.id;
        await replies.accept(STUDENT, h.projectId, replyScope, '我不会，先给我一个提示', `${key}-help`);
        assert.equal((await h.store.findAwaitingQuestion(STUDENT.id, h.planId))?.id, pending.id);
        // Private answer oracle is restricted to this disposable fixture; production grading writes mastery.
        await replies.accept(STUDENT, h.projectId, replyScope, pending.expectedAnswer, key);
      } else if (activity.evidence === 'experiment_observation') {
        const mode = frozen.interactiveSpec?.domainTopic === 'diffraction_slit' ? 'diffraction' : 'interference';
        const parameters = { wavelength: 550, slitWidth: 20, screenDistance: 2, ...(mode === 'interference' ? { slitSeparation: 150 } : {}) };
        const block = await h.experiments.propose(STUDENT.id, { ...scope, projectId: h.projectId, activityId: activity.activityId,
          objectiveId: `${h.planId}:${frozen.objectiveIds[0]}`, tutorSessionId: key }, { title: 'Isolated comparison', summary: 'Simulation only', mode, parameters }, key);
        const record = { sessionId: key, ownerId: STUDENT.id, projectId: h.projectId, turns: [{ blocks: [block] }] } as unknown as TutorSessionRecord;
        await h.experiments.submit(STUDENT.id, record, block.experimentId, { action: 'submit_prediction', payload: { mode, hypothesis: 'The fringe width changes with wavelength.' }, idempotencyKey: `${key}-predict` });
        for (let sample = 0; sample < (frozen.sessionIndex === 4 || frozen.sessionIndex === 6 ? 2 : 1); sample++) {
          const varied = { ...parameters, wavelength: sample ? 450 : 550 };
          const run = await h.experiments.submit(STUDENT.id, record, block.experimentId, { action: 'run', payload: { mode, parameters: varied }, idempotencyKey: `${key}-run-${sample}` });
          await h.experiments.submit(STUDENT.id, record, block.experimentId, { action: 'record_observation', payload: { mode, parameters: varied,
            runActionId: run.actionId, observation: 'Simulated fringe width changes with wavelength while geometry stays fixed.' }, idempotencyKey: `${key}-observe-${sample}` });
          observations++;
        }
      } else if (activity.evidence === 'submitted_artifact') {
        const draft = 'I compare single and double slit observations, their fringe structure, controlled parameters and model limitations.';
        await replies.accept(STUDENT, h.projectId, replyScope, draft, `${key}-draft`);
        assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, 1)).approvedArtifacts.length, 0, 'conversation creates a draft, never a final artifact');
        h.evaluation.fail = true;
        const receipt = await h.learningEvidence.submitArtifact(STUDENT, h.planId, session.id,
          { planRevision: 1, activityId: activity.activityId, content: draft, title: 'Synthetic portfolio', requestReview: true }, key);
        assert.equal(receipt.proof.quality?.status, 'pending');
        assert.notEqual(receipt.artifact.status, 'published');
        h.evaluation.fail = false;
        const recovery = { studentId: STUDENT.id, projectId: h.projectId, ...scope, evidenceRef: receipt.proof.ref };
        await h.learningEvidence.resumeLessonEvaluation(STUDENT, recovery);
        await h.learningEvidence.resumeLessonEvaluation(STUDENT, recovery);
        assert.equal((await h.works.getArtifact(STUDENT, receipt.artifact.id)).status, 'published');
        assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, 1)).submissions.filter(proof => proof.kind === 'submitted_artifact').length, 1);
        await h.lifecycle.reconcile(STUDENT, h.projectId, scope, `${key}-sync`);
        assert.equal((await h.store.findProject(h.projectId))?.status, 'reflection');
        assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 7);
      } else {
        const content = frozen.sessionIndex === 1 ? 'I want to compare how single and double slit patterns change when wavelength changes.'
          : 'The saved simulated observations changed my explanation of the fringe envelope; they do not establish real measurement accuracy.';
        const notice = await replies.accept(STUDENT, h.projectId, replyScope, content, key);
        if (frozen.sessionIndex === 7) assert.match(notice!, /成果正文.*确认最终交付/u, 'owner receipt provides the final entry without depending on model narration');
        const after = await h.progress.readProgress(STUDENT, h.planId);
        assert.equal(after.completedCount, frozen.sessionIndex, 'accepted answer auto-completes without evidence checkboxes or manual completion');
        const replayNotice = await replies.accept(STUDENT, h.projectId, replyScope, content, key);
        if (frozen.sessionIndex === 7) assert.match(replayNotice!, /成果正文.*确认最终交付/u, 'replayed transition retains the current final entry');
        assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, frozen.sessionIndex, 'retry cannot advance a second lesson');
        await assert.rejects(replies.accept(STUDENT, h.projectId, replyScope, content, `${key}-late`));
      }
    }
  }
  assert.equal(observations, 6);
  assert.equal((await h.store.findProject(h.projectId))?.status, 'completed');
  assert.equal((await h.store.findPlan(h.planId))?.status, 'completed');
  assert.ok(h.evaluation.inputs.some(item => item.kind === 'submitted_artifact' && item.evidence.some(e => e.ref.startsWith('experiment_observation:'))));
});

test('saved responses survive evaluation outages and reject stale scope without duplicating evidence', async () => {
  const h = await fullflowHarness(true, true, true, true, false, undefined, true);
  const replies = new TutorLearningReplyService(h.store, h.plans, h.bindings, h.progress, h.learningEvidence, h.lifecycle,
    { isAnswer: async () => true } as unknown as LearningReplyInterpreter, h.keys);
  const sessionId = h.plan.sessions[0]!.id;
  const scope = { planId: h.planId, planRevision: 1, learningSessionId: sessionId, activityId: `${sessionId}:activity:check`, questionId: null };
  await replies.accept(STUDENT, h.projectId, scope, '我不懂，请解释', 'help');
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, sessionId, 1)).submissions.length, 0);
  await assert.rejects(replies.accept({ ...STUDENT, id: 'other-student' }, h.projectId, scope, 'A comparison', 'foreign'));
  await assert.rejects(replies.accept(STUDENT, h.projectId, { ...scope, planRevision: 2 }, 'A comparison', 'stale'));
  h.evaluation.fail = true;
  const text = 'Compare two patterns by changing only the wavelength, keeping the screen position fixed.';
  assert.match((await replies.accept(STUDENT, h.projectId, scope, text, 'answer'))!, /已保存/);
  await replies.accept(STUDENT, h.projectId, scope, text, 'answer');
  const proofs = await h.learningEvidence.getLessonProofs(STUDENT, h.planId, sessionId, 1);
  assert.equal(proofs.submissions.length, 1);
  assert.equal(proofs.submissions[0]!.quality?.status, 'pending');
  const duplicate = await h.learningEvidence.submitResponse(STUDENT, h.planId, sessionId,
    { planRevision: 1, activityId: scope.activityId, content: text }, 'another-tab-key');
  assert.equal(duplicate.proof.ref, proofs.submissions[0]!.ref);
  assert.equal(duplicate.replayed, true);
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 0);
  h.evaluation.fail = false; h.evaluation.advisoryMeets = false;
  await h.learningEvidence.evaluateLessonQuality(STUDENT, h.planId, sessionId, 1, proofs.submissions[0]!.ref);
  await h.lifecycle.reconcile(STUDENT, h.projectId, scope, 'recover');
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 1);
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, sessionId, 1)).submissions.length, 1);
});

test('a mixed answer and help request reaches the evidence owner while pure help stays ungraded', async () => {
  const h = await fullflowHarness(true, true, true, true, false, undefined, true);
  const classified: string[] = [];
  const replies = new TutorLearningReplyService(h.store, h.plans, h.bindings, h.progress, h.learningEvidence, h.lifecycle,
    { isAnswer: async (text: string) => { classified.push(text); return true; } } as unknown as LearningReplyInterpreter, h.keys);
  const sessionId = h.plan.sessions[0]!.id;
  const scope = { planId: h.planId, planRevision: 1, learningSessionId: sessionId, activityId: `${sessionId}:activity:check`, questionId: null };
  await replies.accept(STUDENT, h.projectId, scope, '我不懂，请解释', 'pure-help');
  assert.equal(classified.length, 0);
  const answer = '我原来不知道，现在想比较两种条纹，只改变波长。请给我一个提示，怎么保持屏幕位置不变？';
  await replies.accept(STUDENT, h.projectId, scope, answer, 'mixed-answer');
  assert.deepEqual(classified, [answer]);
  const saved = await h.learningEvidence.getLessonProofs(STUDENT, h.planId, sessionId, 1);
  assert.equal(saved.submissions.length, 1);
  const artifact = await h.works.getArtifact(STUDENT, saved.submissions[0]!.artifactId!);
  assert.equal(artifact.latestVersion?.inlineText, answer);
});

test('new qualitative checks accept semantic paraphrases; evaluator outages leave the question ungraded', async () => {
  const spec = WAVE_DIALOGUE_TEMPLATE_SPEC, profile = spec.curriculum!.profiles[0]!, lesson = profile.sessions[1]!;
  const bundle = { plan: { id: 'plan', projectId: 'project', templateVersion: 'frozen' } } as PlanBundle;
  const pending = { id: 'question', sessionId: `plan:${lesson.id}`, objectiveId: `plan:${lesson.objectiveIds[0]}`,
    assessmentType: 'qualitative', options: [], prompt: '解释同向与反向波幅的叠加。', expectedAnswer: '同向振幅相加，反向相减；强度不能为负。' } as unknown as PendingQuestionRecord;
  const grade = { questionId: 'question', result: 'incorrect' as const, isCorrect: false, score: 0, explanation: 'reference', errorType: null, remediation: null };
  let calls = 0, unavailable = false;
  const evaluator = { evaluate: async () => { calls++; if (unavailable) throw new Error('isolated outage');
    return { providerId: 'fixture', modelId: 'fixture', criteria: [{ criterionId: 'current-question-understanding', meets: true, feedback: 'Equivalent meaning.' }] }; } } as unknown as LessonQualityEvaluator;
  const bindings = { getFrozenTeachingBundle: async () => ({ template: spec, scheduleProfileId: profile.id }) } as unknown as TemplateBindingService;
  const input = { bundle, pending, grade, bindings, evaluator, answer: '一起向上的位移会累加，方向相反就抵消一些，亮度最低只能到零。' };
  assert.equal((await reviewDialogueAnswer(input)).grade.isCorrect, true);
  unavailable = true;
  await assert.rejects(reviewDialogueAnswer(input), error => (error as { getResponse(): { code: string } }).getResponse().code === 'FORMAL_ANSWER_EVALUATION_UNAVAILABLE');
  const oldBindings = { getFrozenTeachingBundle: async () => ({ template: WAVE_TEACHING_TEMPLATE_SPEC }) } as unknown as TemplateBindingService;
  assert.equal((await reviewDialogueAnswer({ ...input, bindings: oldBindings })).grade.isCorrect, false);
  assert.equal(calls, 2, 'old frozen rules never silently use a new semantic reviewer');
});
