import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fullflowHarness, STUDENT } from './optics-fullflow.test-fixture';
import type { TutorSessionRecord } from '../ai-tutor/tutor.service';

for (const zeroBase of [false, true]) test(`eight wave lessons close through owners in an isolated fixture (zero-base=${zeroBase})`, async () => {
  const h = await fullflowHarness(true, true, true, zeroBase);
  h.directory.currentMentorId = null;
  const revision = h.plan.plan.version;
  const profile = h.teaching.template.curriculum!.profiles[0]!;
  assert.equal(h.plan.sessions.length, 8);
  assert.ok(h.teaching.roles.every(role => role.assistantId !== 'qitu-intake-assistant'));
  let answers = 0, observations = 0, reflections = 0;
  for (const session of h.plan.sessions) {
    const frozen = profile.sessions[session.lessonIndex - 1]!;
    const scope = { planId: h.planId, planRevision: revision, learningSessionId: session.id };
    assert.equal((await h.current()).role.assistantId, frozen.leadAssistantId);
    for (let step = 0; ; step++) {
      assert.ok(step < 7, 'each lesson must converge through its frozen activities');
      const view = await h.progress.readProgress(STUDENT, h.planId);
      const activity = view.sessions.find(item => item.sessionId === session.id)!.activities!.find(item => item.status === 'current');
      if (!activity) break;
      const key = `wave8-${session.lessonIndex}-${activity.kind}`;
      const submission = { planRevision: revision, activityId: activity.activityId,
        content: 'Isolated learner response: I compare one parameter, retain units, distinguish fine fringes and the envelope, and identify model limitations.' };
      if (activity.evidence === 'teaching_delivery') {
        const instance = await h.courseware.capture({ actor: STUDENT, curriculumHash: teachingValueDigest(h.teaching.template),
          scope: { ...scope, projectId: h.projectId, activityId: activity.activityId },
          content: { title: frozen.title, steps: [{ caption: 'Isolated source-grounded explanation and comparison.', tex: 'y=y_1+y_2' }] },
          objectiveRefs: [...frozen.objectiveIds], sources: [{ knowledgeBaseId: 'synthetic-kb', documentRefHash: 'a'.repeat(64), title: 'Isolated verified source' }], key });
        assert.equal((await h.current()).lesson.currentActivity?.activityId, activity.activityId, 'delivery alone cannot complete teaching');
        await h.courseware.acknowledge(STUDENT, instance, 0, true, `${key}-continue`);
        const restored = await h.coursewareStore.instances(h.projectId, h.planId, revision, session.id);
        assert.ok(restored.find(v => v.id === instance.id)?.acknowledgedAt);
      } else if (activity.evidence === 'mastery') {
        assert.equal(session.lessonIndex, 2, 'only the explicit readiness objectives are mastery-gated');
        const ids = frozen.completionSpec!.requiredMasteryObjectiveIds.map(id => `${h.planId}:${id}`);
        for (let round = 0; !await h.mastery.checkRequiredObjectives(STUDENT, STUDENT.id, h.planId, ids, h.store); round++) {
          assert.ok(round < 18);
          const started = await h.assessment.start(STUDENT, h.projectId, scope);
          assert.ok(started.nextStep?.question);
          const question = await h.store.findPendingQuestion(started.nextStep.question.questionId); assert.ok(question);
          // Private oracle exists only in this disposable fixture; answers still pass through the real grading owner.
          const result = await h.assessment.answer(STUDENT, h.projectId, { ...scope, questionId: question.id, answer: question.expectedAnswer }, `wave-answer-${answers++}`);
          assert.equal(result.answer.isCorrect, true);
          assert.equal(result.answer.mastery?.qualitativeMastered, true);
          const ready = await h.mastery.checkRequiredObjectives(STUDENT, STUDENT.id, h.planId, ids, h.store);
          assert.equal((await h.store.findProject(h.projectId))?.status, ready ? 'practice_ready' : 'theory_check');
        }
        assert.equal((await h.progress.readProgress(STUDENT, h.planId)).currentSessionId, session.id,
          'theory readiness must not complete the lesson or skip reflection/quality evidence');
        const future = h.plan.sessions[2]!, futureLesson = profile.sessions[2]!;
        await assert.rejects(h.experiments.propose(STUDENT.id,
          { ...scope, projectId: h.projectId, learningSessionId: future.id, tutorSessionId: 'future-chat',
            objectiveId: `${h.planId}:${futureLesson.objectiveIds[0]}` },
          { title: 'Future lesson', summary: 'Must not skip current lesson', mode: 'interference',
            parameters: { wavelength: 550, slitWidth: 20, slitSeparation: 150, screenDistance: 2 } }, 'future-experiment'),
        error => (error as { getResponse(): { code: string } }).getResponse().code === 'TUTOR_EXPERIMENT_REVISION_CHANGED');
      } else if (activity.evidence === 'experiment_observation') {
        const mode = frozen.interactiveSpec?.domainTopic === 'diffraction_slit' ? 'diffraction' : 'interference';
        const parameters: Record<string, number> = mode === 'interference'
          ? { wavelength: 550, slitWidth: 20, slitSeparation: 150, screenDistance: 2 }
          : { wavelength: 550, slitWidth: 50, screenDistance: 2 };
        const chatId = `wave-chat-${session.lessonIndex}`;
        if (session.lessonIndex === 3) {
          // Disposable fixture simulates an old completion that never synchronized its project stage.
          await h.store.transitionProject(STUDENT.id, h.projectId, 'practice_building', 'theory_check', async () => {});
        }
        const block = await h.experiments.propose(STUDENT.id, { ...scope, projectId: h.projectId,
          objectiveId: `${h.planId}:${frozen.objectiveIds[0]!}`, tutorSessionId: chatId, activityId: activity.activityId },
        { title: 'Registered wave comparison', summary: 'A simulated observation, not a measurement.', mode, parameters }, key);
        assert.equal(block.specVersion, '2.0.0');
        assert.equal((await h.store.findProject(h.projectId))?.status, 'practice_building');
        const record = { sessionId: chatId, ownerId: STUDENT.id, projectId: h.projectId,
          turns: [{ blocks: [block] }] } as unknown as TutorSessionRecord;
        await h.experiments.submit(STUDENT.id, record, block.experimentId,
          { action: 'submit_prediction', payload: { mode, hypothesis: 'I predict a change in the pattern when the chosen variable changes.' }, idempotencyKey: `${key}-predict` });
        const count = session.lessonIndex === 4 || session.lessonIndex === 6 ? 2 : 1;
        for (let sample = 0; sample < count; sample++) {
          const varied = { ...parameters, wavelength: sample ? 450 : 550 };
          const run = await h.experiments.submit(STUDENT.id, record, block.experimentId,
            { action: 'run', payload: { mode, parameters: varied }, idempotencyKey: `${key}-run-${sample}` });
          assert.equal(run.simulationResult?.waveProjection?.mode, mode);
          const observed = await h.experiments.submit(STUDENT.id, record, block.experimentId,
            { action: 'record_observation', payload: { mode, parameters: varied, runActionId: run.actionId,
              observation: 'This simulated comparison retains aperture geometry and screen distance while varying wavelength.' }, idempotencyKey: `${key}-observe-${sample}` });
          assert.ok(observed.observationReceipt); observations++;
          assert.equal(h.evaluation.inputs.at(-1)?.activity?.activity, 'practice',
            'observation quality must retain its owner-issued activity, not lose scope and grade the final artifact early');
        }
      } else if (activity.evidence === 'submitted_artifact') {
        const report = await h.learningEvidence.submitArtifact(STUDENT, h.planId, session.id,
          { ...submission, title: 'Isolated interference and diffraction portfolio', requestReview: true }, key);
        assert.equal(report.artifact.status, 'published');
      } else if (session.lessonIndex === 8 && activity.kind === 'reflect') {
        const result = await h.learningEvidence.submitReflection(STUDENT, h.planId, session.id, submission, key);
        assert.equal(result.proof.sourceKind, 'reflection'); reflections++;
      } else {
        await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id, submission, key);
        if (activity.kind === 'check' && frozen.phase === 'guided_practice') {
          assert.equal(h.evaluation.inputs.at(-1)?.activity?.activity, 'check');
          await assert.rejects(h.progress.complete(STUDENT, h.planId, session.id,
            { projectId: h.projectId, planRevision: revision, evidenceRefs: [] }, `${key}-cannot-skip-practice`));
        }
      }
      assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, session.lessonIndex - 1);
    }
    const completion = { projectId: h.projectId, planRevision: revision, evidenceRefs: [] };
    const completeKey = `wave-complete-${session.lessonIndex}`;
    if (session.lessonIndex === 2) {
      const reconcile = h.lifecycle.reconcile.bind(h.lifecycle);
      h.lifecycle.reconcile = async () => { throw new Error('isolated synchronization outage'); };
      await assert.rejects(h.lifecycle.completeLesson(STUDENT, h.planId, session.id, completion, completeKey), /isolated synchronization outage/);
      h.lifecycle.reconcile = reconcile;
      assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 2, 'completion survives the synchronization outage');
    }
    const done = await h.lifecycle.completeLesson(STUDENT, h.planId, session.id, completion, completeKey);
    assert.equal(done.progress.completedCount, session.lessonIndex);
    if (session.lessonIndex === 2) {
      assert.equal(done.replayed, true);
      assert.equal((await h.store.findProject(h.projectId))?.status, 'practice_building', 'no separate browser reconcile is needed');
    }
  }
  assert.ok(answers >= 3); assert.equal(observations, 7); assert.equal(reflections, 1);
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 8);
  assert.equal((await h.store.findProject(h.projectId))?.status, 'completed');
  const reflection = h.evaluation.inputs.find(input => input.activityId === `${h.plan.sessions[1]!.id}:activity:reflect`)!;
  assert.ok(reflection, 'the theory reflection must be evaluated');
  const readiness = reflection.evidence.find(item => item.ref.startsWith('server-mastery:'))!;
  assert.ok(JSON.parse(readiness.content).objectives.every((item: { accepted: boolean }) => item.accepted),
    'evaluation must receive the same verified readiness facts as lesson progress');
  if (zeroBase) assert.ok(reflection.evidence.some(item => item.ref.startsWith('courseware:')),
    'viewed diagrams must remain available as context without becoming mastery facts');
  const comparison = h.evaluation.inputs.find(input => input.activityId === `${h.plan.sessions[6]!.id}:activity:check`)!;
  assert.ok(comparison.evidence.some(item => item.ref.startsWith('experiment_observation:')),
    'the synthesis lesson must receive accepted observations from earlier lessons in the same frozen plan');
  assert.ok(!reflection.evidence.some(item => item.ref.startsWith('experiment_observation:')),
    'future lesson observations must not appear in the initial theory reflection');
  const finalReflection = h.evaluation.inputs.find(input => input.activityId === `${h.plan.sessions[7]!.id}:activity:reflect`)!;
  assert.ok(finalReflection.evidence.filter(item => item.ref.startsWith('artifact:'))
    .every(item => item.content.startsWith('Owner-verified saved evidence from lesson 7;')),
    'a project-wide published artifact must retain its actual lesson attribution');
});
