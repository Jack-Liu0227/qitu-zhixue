import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPTICS_16_SESSION_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { QITU_SKILL_ROLE_PRESETS, parseProjectTemplateSpec } from '@qitu/contracts';
import { loadRuntimeSkillCatalog, loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { skillLifecycleCatalog } from '../admin-copilot/copilot.skill-lifecycle';
import { compileTeachingBundle } from './teaching-bundle.compiler';
import { teachingValueDigest } from './teaching-bundle.canonical';
import { TeachingBundleCompilationError, type TeachingBundleSource } from './teaching-bundle.types';
import { createLessonActivityChannel, LESSON_ACTIVITY_TOOL } from '../ai-tutor/tutor-lesson-activity';
import { LESSON_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/lesson-activity.schema';
import { teachingContextFixture } from '../ai-tutor/tutor-teaching-context.test-fixture';
import { resolveTutorTeachingContext } from '../ai-tutor/tutor-teaching-context';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';

function sourceFixture(): TeachingBundleSource {
  const catalog = loadTutorRuntimeSource();
  const template = structuredClone(OPTICS_16_SESSION_TEMPLATE_SPEC);
  template.phases = template.phases.map(phase => ({ ...phase, assignedAssistantId: null }));
  const profile = template.curriculum!.profiles[0]!;
  const preset = QITU_SKILL_ROLE_PRESETS.inquiry;
  const skills = preset.skillIds.map(id => {
    const skill = catalog.skills.find(item => item.id === id);
    assert.ok(skill && skill.status === 'ready' && skill.publicationStatus === 'published', id);
    return { canonicalId: id, version: skill.version!, packageDigest: skill.contentHash };
  });
  for (const session of profile.sessions) {
    session.requiredSkillIds = ['pbl-dynamic-lesson', 'pbl-source-literacy'];
    session.teachingRequirements = ['dynamic_lesson'];
  }
  const tools = [{ toolId: LESSON_ACTIVITY_TOOL, schemaDigest: teachingValueDigest(LESSON_ACTIVITY_SCHEMA),
    handlerVersion: 'tutor.propose_lesson_activity.v1', mcpServerId: null }];
  const model = { modelProviderId: 'isolated-provider', modelId: 'isolated-model', policyVersion: 'isolated-policy' };
  return {
    templateVersionId: 'new-lifecycle-template-version', template, scheduleProfileId: profile.id,
    teamVersion: { teamVersionId: 'new-lifecycle-team-version', teamId: template.teamId,
      leaderAssistantId: 'real-inquiry-assistant', members: [{ memberId: 'inquiry-member', assistantId: 'real-inquiry-assistant' }] },
    roles: [{ roleSlotId: 'inquiry-role', memberId: 'inquiry-member', purposes: ['outline', 'session', 'dialogue'], skills, toolIds: [LESSON_ACTIVITY_TOOL] }],
    sessionRoutes: profile.sessions.map(session => ({ sessionIndex: session.sessionIndex, roleSlotId: 'inquiry-role' })),
    assistants: [{ assistantId: 'real-inquiry-assistant', enabled: true, roleDefinition: 'Investigate evidence', agentDefinition: 'Ask for predictions',
      skillIds: [...preset.skillIds], toolIds: [LESSON_ACTIVITY_TOOL], mcpServerIds: [], modelByPurpose: { outline: model, session: model, dialogue: model } }],
    skillArtifacts: skills.map(pin => ({ ...pin, runtime: 'teaching', status: 'published',
      requiredToolIds: catalog.skills.find(item => item.id === pin.canonicalId)!.requiredToolIds ?? [] })),
    tools, knowledgeGrant: null,
    approval: { version: 'isolated-policy', models: [model], toolIds: [LESSON_ACTIVITY_TOOL], mcpServerIds: [], imaKnowledgeBaseIds: [] },
  };
}

test('real adapted packages compile into actual template session routes with immutable package pins', () => {
  const source = sourceFixture();
  const compiled = compileTeachingBundle(source);
  assert.equal(compiled.payload.sessionRoutes.length, source.template.curriculum!.profiles[0]!.sessions.length);
  assert.equal(compiled.payload.roles[0]!.assistantId, 'real-inquiry-assistant');
  assert.ok(compiled.payload.roles[0]!.skills.some(skill => skill.canonicalId === 'pbl-dynamic-lesson'));
  assert.ok(compiled.payload.template.curriculum!.profiles[0]!.sessions.every(session => session.requiredSkillIds?.includes('pbl-source-literacy')));
  assert.equal(compiled.payload.templateDigest, teachingValueDigest(source.template));
  source.roles = [{ ...source.roles[0]!, skills: source.roles[0]!.skills.filter(skill => skill.canonicalId !== 'pbl-source-literacy') }];
  assert.throws(() => compileTeachingBundle(source), error => error instanceof TeachingBundleCompilationError && error.issue === 'SESSION_SKILL_REQUIRED');
  assert.ok(compiled.payload.roles[0]!.skills.some(skill => skill.canonicalId === 'pbl-source-literacy'));
});

test('new templates reject labels, duplicate skill requirements, absent dependencies and revoked packages', () => {
  const source = sourceFixture();
  source.template.curriculum!.profiles[0]!.sessions[0]!.requiredSkillIds = ['Deep Interactive'];
  assert.throws(() => parseProjectTemplateSpec(source.template));
  source.template.curriculum!.profiles[0]!.sessions[0]!.requiredSkillIds = ['pbl-source-literacy', 'pbl-source-literacy'];
  assert.throws(() => parseProjectTemplateSpec(source.template));
  const revoked = sourceFixture();
  revoked.skillArtifacts = revoked.skillArtifacts.map(skill => ({ ...skill, status: 'revoked' }));
  assert.throws(() => compileTeachingBundle(revoked), error => error instanceof TeachingBundleCompilationError && error.issue === 'SKILL_REVIEW_REQUIRED');
  const missing = sourceFixture(); missing.roles = [{ ...missing.roles[0]!, toolIds: [] }];
  assert.throws(() => compileTeachingBundle(missing), error => error instanceof TeachingBundleCompilationError && error.issue === 'SKILL_TOOL_DEPENDENCY_MISSING');
});

test('adapted deep interaction uses the existing candidate owner and preserves private answer keys', async () => {
  const f = teachingContextFixture();
  const teaching = await resolveTutorTeachingContext(f.store, f.project, f.teaching);
  const runtime = { agent: { id: teaching.role.assistantId, enabled: true, capabilities: ['teach'] },
    skills: [{ id: 'pbl-dynamic-lesson', publicationStatus: 'published' }],
    tools: [{ id: LESSON_ACTIVITY_TOOL, version: 'tutor.propose_lesson_activity.v1', inputSchemaDigest: teachingValueDigest(LESSON_ACTIVITY_SCHEMA) }],
    mcpServers: [] } as unknown as EffectiveAgentRuntime;
  let writes = 0;
  const channel = createLessonActivityChannel({ teaching, runtime,
    scope: { projectId: f.project.id, planId: teaching.planId, planRevision: teaching.planRevision,
      learningSessionId: teaching.session.id, objectiveId: teaching.objective!.id, tutorSessionId: 'synthetic-chat' },
    idempotencyKey: 'lifecycle-choice', refresh: async () => ({ teaching, runtime }), verifyEvidence: async () => [],
    acceptQuestion: async () => { writes++; return { kind: 'quiz', questionId: 'owner-instance', stem: 'Which relation follows?', options: [{ key: 'a', text: 'First' }, { key: 'b', text: 'Second' }] }; },
    proposeOptics: async () => { throw new Error('practice owner required'); },
  });
  assert.equal(channel.tools.length, 1);
  const candidate = { kind: 'choice_question', question: { prompt: 'Which relation follows?', options: [{ text: 'First' }, { text: 'Second' }],
    correctOptionIndex: 1, explanation: 'PRIVATE_ANSWER', sourceRefs: ['owned-source'], difficulty: 'easy' } };
  const replies = await Promise.all([channel.tools[0]!.execute(candidate), channel.tools[0]!.execute(candidate)]);
  assert.equal(writes, 1);
  assert.equal(channel.blocks()[0]!.kind, 'quiz');
  assert.doesNotMatch(JSON.stringify({ replies, blocks: channel.blocks() }), /PRIVATE_ANSWER|correctOptionIndex/);
  runtime.skills[0]!.publicationStatus = 'revoked';
  await assert.rejects(channel.tools[0]!.execute(candidate));
  assert.equal(writes, 1);
});

test('Admin sees current role readiness and reads authoring skills without granting them to teaching', () => {
  const catalog = loadRuntimeSkillCatalog();
  const plan = skillLifecycleCatalog(catalog);
  assert.ok(plan.authoring.every(skill => skill.ready));
  assert.ok(plan.roles.every(role => role.skills.every(skill => skill.ready && skill.packageDigest)));
  assert.equal(plan.roles.find(role => role.role === 'profile')!.skills[0]!.id, 'qitu-learner-profile');
  assert.ok(loadTutorRuntimeSource().skills.every(skill => !plan.authoring.some(admin => admin.id === skill.id)));
});
