import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLessonActivityChannel, LESSON_ACTIVITY_TOOL } from './tutor-lesson-activity';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import { resolveTutorTeachingContext } from './tutor-teaching-context';
import { builtinToolRegistry } from '../platform-registry/built-in-tools';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';

test('a rejected board receives bounded repair guidance and a corrected retry accepts one instance', async () => {
  const fixture = teachingContextFixture();
  const teaching = await resolveTutorTeachingContext(fixture.store, fixture.project, fixture.teaching);
  const runtime: EffectiveAgentRuntime = {
    agent: { id: teaching.role.assistantId, label: 'Synthetic teacher', description: null, role: 'teacher',
      roleDefinition: '', agentDefinition: '', parentAgentId: null, enabled: true, status: 'enabled',
      modelProviderId: null, modelId: null, modelLabel: null, modelAvailable: true, promptVersion: 'synthetic',
      capabilities: ['teach'], skillIds: ['pbl-dynamic-lesson'], toolIds: [LESSON_ACTIVITY_TOOL], mcpServerIds: [], mcpToolIds: {} },
    policy: { id: 'AGENTS.md', version: 'synthetic', contentHash: null, status: 'ready', content: '' },
    skills: [{ id: 'pbl-dynamic-lesson', label: 'Dynamic lesson', description: null, version: '1.0.0',
      contentHash: 'synthetic', content: '', status: 'ready', runtime: 'teaching', publicationStatus: 'published' }],
    tools: builtinToolRegistry.listForAgentIds([LESSON_ACTIVITY_TOOL]),
    mcpServers: [],
  };
  const channel = createLessonActivityChannel({
    teaching, runtime, scope: { projectId: fixture.project.id, planId: teaching.planId,
      planRevision: teaching.planRevision, learningSessionId: teaching.session.id,
      objectiveId: teaching.objective!.id, tutorSessionId: 'synthetic-feedback-session' },
    idempotencyKey: 'synthetic-feedback-turn', refresh: async () => ({ teaching, runtime }),
    verifyEvidence: async () => [], acceptQuestion: async () => { throw Error('not used'); },
    proposeOptics: async () => { throw Error('not used'); },
  });
  const tool = channel.tools[0]!;
  const board = { kind: 'board', title: 'Observe and explain', steps: [{ caption: 'Which statement is an observation?',
    nodes: [{ id: 'observe', label: 'Observation' }], edges: [] }] };
  for (const bad of [
    { ...board, summary: 'An extra field' },
    { ...board, steps: [{ ...board.steps[0], tex: '' }] },
    { ...board, steps: [{ caption: 'No executable material', tex: '\\href{https://invalid.example}{x}' }] },
  ]) {
    const rejected = await tool.execute(bad);
    assert.equal(rejected.isError, true);
    assert.match(rejected.text, /BOARD_CANDIDATE_INVALID/);
    assert.doesNotMatch(rejected.text, /invalid\.example|An extra field/);
    assert.equal(channel.blocks().length, 0);
  }
  const accepted = await tool.execute(board);
  assert.notEqual(accepted.isError, true);
  await tool.execute(board);
  assert.equal(channel.blocks().length, 1);
  runtime.agent.enabled = false;
  await assert.rejects(tool.execute(board));
});
