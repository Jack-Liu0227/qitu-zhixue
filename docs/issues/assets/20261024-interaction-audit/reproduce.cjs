const assert = require('node:assert/strict');
const api = '/root/qitu-zhixue/services/api/dist/modules/';
const { TutorCoursewareService } = require(api + 'ai-tutor/tutor-courseware.service.js');
const { createCoursewareActivityPort } = require(api + 'ai-tutor/tutor-courseware-activity.js');
const { coursewareToolSchema } = require(api + 'ai-tutor/courseware-tool-schema.js');

(async () => {
  const spec = { concepts: [{ objectiveId: 'a', introduction: 'A' }, { objectiveId: 'b', introduction: 'B' }] };
  const teaching = { planId: 'fixture-plan', planRevision: 1, session: { id: 'fixture-session', lessonIndex: 1 },
    bundle: { scheduleProfileId: 'profile', template: { curriculum: { profiles: [{ id: 'profile', sessions: [{ sessionIndex: 1, teachingSpec: spec }] }] } } },
    role: { modelByPurpose: {}, skills: [] },
    lesson: { currentActivity: { activityId: 'theory', kind: 'theory' } } };
  const instances = [{ id: 'old', activityId: 'review' }, { id: 'fresh', activityId: 'theory' }];
  const service = new TutorCoursewareService({}, { instances: async () => instances }, {}, {}, { findAwaitingQuestion: async () => null });
  // Isolated fixtures replace external authorization/retrieval; read aggregation is the deployed implementation.
  service.current = async () => ({ teaching });
  service.verify = async (_actor, _context, instance) => instance.id === 'fresh';
  const result = await service.read({ id: 'synthetic-student', role: 'student' }, 'synthetic-project');
  assert.equal(result.instances.length, 1);
  assert.equal(result.instances[0].id, 'fresh');
  assert.equal(result.canContinue, false);
  assert.ok(result.blockedReason);

  let captures = 0;
  const port = createCoursewareActivityPort({ teaching, scope: { activityId: 'theory' }, studentId: 'synthetic-student',
    service: { deliveredObjectives: async () => ['a'], capture: async input => { captures++; return { id: 'new', content: input.content }; } },
    verify: async () => [{ sourceRef: 'knowledge-read:fixture', knowledgeBaseId: 'fixture', documentRefHash: 'a'.repeat(64), title: 'Fixture' }],
    allowedLibraries: async () => ['fixture'] });
  const repeat = await port.execute({ kind: 'board', title: 'Explain A again with a different example',
    steps: [{ caption: 'A different explanation', tex: 'a+a=2a' }], objectiveRefs: ['a'], sourceRefs: ['knowledge-read:fixture'] }, 'retry-a');
  assert.equal(repeat.block, undefined);
  assert.equal(captures, 0);
  assert.equal(JSON.parse(repeat.text).remainingConcepts[0].objectiveId, 'b');
  const kinds = coursewareToolSchema(['a', 'b']).oneOf.map(branch => branch.properties.kind.const);
  assert.deepEqual(kinds, ['find_courseware', 'reuse_courseware', 'board']);
  console.log(JSON.stringify({ fixtureOnly: true, productionLearningWrites: 0,
    stalePreviousCourseware: { validInstances: result.instances.length, canContinue: result.canContinue, blockedReason: result.blockedReason },
    explicitReexplanationOfAcknowledgedConcept: { accepted: !!repeat.block, createdInstances: captures, remainingObjectives: ['b'] },
    nonPracticeCoursewareToolKinds: kinds }));
})().catch(error => { console.error(error); process.exitCode = 1; });
