import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INSPIRATION_COURSES } from '../templates/content/inspiration';
import { fullflowHarness, STUDENT } from './optics-fullflow.test-fixture';
import { pblGateEvidence } from '@qitu/database';
import type { AuditTransaction } from '../../common/audit/audit.service';

function isolatedGateLedger() {
  const rows: Array<{ gate: string; evidenceRef: string; studentUserId: string }> = [];
  const transaction = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }),
    insert: (table: unknown) => {
      assert.equal(table, pblGateEvidence);
      return { values: (row: typeof rows[number]) => ({ onConflictDoNothing: async () => {
        if (!rows.some(prior => prior.gate === row.gate && prior.evidenceRef === row.evidenceRef && prior.studentUserId === row.studentUserId)) rows.push(row);
      } }) };
    },
  } as unknown as AuditTransaction;
  return { rows, transaction };
}

for (const course of INSPIRATION_COURSES) {
  test(`${course.slug}: eight lessons finish through production owners without a teacher`, async () => {
    const h = await fullflowHarness(true, true, false, false, false, course);
    h.directory.currentMentorId = null;
    const gates: Array<{ gate: string; evidenceRef: string }> = [];
    const ledger = isolatedGateLedger();
    const record = h.teamRuntime.recordGateForStudent.bind(h.teamRuntime);
    h.teamRuntime.recordGateForStudent = async input => { gates.push(input); return record(input, ledger.transaction); };
    let answerIndex = 0, wrongRecovered = false, artifactVersion = '';
    for (const session of h.plan.sessions) {
      const scope = { planId: h.planId, planRevision: h.plan.plan.version, learningSessionId: session.id };
      const frozen = course.spec.curriculum!.profiles[0]!.sessions[session.lessonIndex - 1]!;
      assert.equal((await h.current()).lesson.assistantId, frozen.leadAssistantId);
      for (let step = 0; ; step++) {
        assert(step < 9, 'current activities must converge from accepted evidence');
        const progress = await h.progress.readProgress(STUDENT, h.planId);
        const activity = progress.sessions.find(item => item.sessionId === session.id)!.activities!.find(item => item.status === 'current');
        if (!activity) break;
        const key = `${course.slug}-${session.lessonIndex}-${activity.kind}`;
        if (activity.evidence === 'mastery') {
          for (let attempt = 0; ; attempt++) {
            assert(attempt < 20, 'formal assessment must allow bounded remediation');
            if ((await h.current()).lesson.currentActivity?.evidence !== 'mastery') break;
            const view = await h.assessment.start(STUDENT, h.projectId, scope);
            if (view.nextStep?.action === 'complete') break;
            assert(view.nextStep?.question);
            const pending = await h.store.findPendingQuestion(view.nextStep.question.questionId); assert(pending);
            const restored = await h.assessment.start(STUDENT, h.projectId, scope);
            assert.equal(restored.nextStep?.question?.questionId, pending.id);
            const wrong: boolean = !wrongRecovered;
            const input = { ...scope, questionId: pending.id, answer: wrong ? 'Isolated fixture wrong answer.' : pending.expectedAnswer };
            const result = await h.assessment.answer(STUDENT, h.projectId, input, `answer-${answerIndex++}`);
            assert.equal(result.answer.isCorrect, !wrong);
            if (wrong) {
              assert.equal(result.answer.theoryMastered, false);
              assert.notEqual((await h.store.findProject(h.projectId))?.status, 'practice_ready');
              wrongRecovered = true;
            }
            const replay = await h.assessment.answer(STUDENT, h.projectId, input, `answer-${answerIndex - 1}`);
            assert.equal(replay.answer.replayed, true);
          }
          if (session.lessonIndex === 2) assert.notEqual((await h.store.findProject(h.projectId))?.status, 'practice_ready');
          if (session.lessonIndex === 3) assert.equal((await h.store.findProject(h.projectId))?.status, 'practice_ready');
        } else {
          const submission = { planRevision: scope.planRevision, activityId: activity.activityId,
            content: `Disposable synthetic fixture for ${course.spec.title}. ${frozen.learningGoal}\n${frozen.evidenceRequirements?.join('\n')}\nThis is owner-contract test data, not actual observation, user research, source verification or learner achievement.` };
          if (activity.evidence === 'submitted_artifact') {
            const saved = await h.learningEvidence.submitArtifact(STUDENT, h.planId, session.id, { ...submission, title: 'Isolated portfolio', requestReview: true }, key);
            assert.equal(saved.artifact.status, 'published');
            artifactVersion = saved.proof.artifactVersionId!;
            assert.equal((await h.artifacts.listReviewsForArtifact(saved.artifact.id)).length, 0);
            const evaluation = h.evaluation.inputs.find(input => input.kind === 'submitted_artifact'); assert(evaluation);
            assert.deepEqual(evaluation.criteria.map(item => item.id).sort(), course.rubric.map(item => item.id).sort());
          } else if (session.lessonIndex === 8 && activity.kind === 'reflect') {
            await h.learningEvidence.submitReflection(STUDENT, h.planId, session.id, submission, key);
          } else await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id, submission, key);
        }
      }
      const request = { projectId: h.projectId, planRevision: scope.planRevision, evidenceRefs: [] };
      const completed = await h.lifecycle.completeLesson(STUDENT, h.planId, session.id, request, `complete-${session.lessonIndex}`);
      assert.equal(completed.progress.completedCount, session.lessonIndex);
      const replay = await h.lifecycle.completeLesson(STUDENT, h.planId, session.id, request, `complete-${session.lessonIndex}`);
      assert.equal(replay.progress.completedCount, session.lessonIndex);
    }
    assert(wrongRecovered && answerIndex >= 5);
    assert(gates.some(item => item.gate === 'rubric_artifact_validated' && item.evidenceRef === `artifact_version:${artifactVersion}`));
    assert.equal(ledger.rows.filter(item => item.gate === 'rubric_artifact_validated' && item.evidenceRef === `artifact_version:${artifactVersion}`).length, 1);
    assert.equal((await h.store.findProject(h.projectId))?.status, 'completed');
    assert.equal((await h.store.findPlan(h.planId))?.status, 'completed');
  });
}
