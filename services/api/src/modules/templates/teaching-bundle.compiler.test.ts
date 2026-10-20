import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PBL_LEARNING_CONTRACT_VERSION, type ProjectTemplateSpec } from '@qitu/contracts';
import { compileTeachingBundle } from './teaching-bundle.compiler';
import { teachingValueDigest } from './teaching-bundle.canonical';
import {
  TeachingBundleCompilationError, type TeachingAssistantSource, type TeachingBundleSource,
} from './teaching-bundle.types';

const SKILL_DIGEST = 'a'.repeat(64);
const TOOL_DIGEST = 'b'.repeat(64);

function fixture(): TeachingBundleSource {
  const phases: ProjectTemplateSpec['phases'] = [
    { phase: 'exploration', title: 'Explore', objectiveIds: ['observe'], gateCondition: 'student_confirmed_intent', deliverableType: null, assignedAssistantId: null },
    { phase: 'concept_mastery', title: 'Concept', objectiveIds: ['concept'], gateCondition: 'TheoryMastered', deliverableType: null, assignedAssistantId: null },
    { phase: 'guided_practice', title: 'Practice', objectiveIds: ['measure'], gateCondition: 'experiment_report_validated', deliverableType: 'experiment_report', assignedAssistantId: null },
    { phase: 'deliverable_review', title: 'Review', objectiveIds: ['reflect'], gateCondition: 'review_completed_and_archived', deliverableType: null, assignedAssistantId: null },
  ];
  const schedule = { lessonCount: 4, lessonMinutes: 120 } as const;
  return {
    templateVersionId: 'template-version-2', scheduleProfileId: 'four-lessons',
    template: {
      contractVersion: PBL_LEARNING_CONTRACT_VERSION, id: 'synthetic-inquiry', version: 'v2', status: 'piloting',
      title: 'Synthetic inquiry', description: 'A synthetic test without learner data.', targetDomain: 'physics',
      ageRange: { min: 13, max: 18 }, prerequisites: [], materials: [], safetyRequirements: ['Simulation only.'],
      objectives: [
        { id: 'observe', title: 'Observe', description: 'Describe an observation.', kind: 'concept', prerequisiteIds: [] },
        { id: 'concept', title: 'Explain', description: 'Probe a concept.', kind: 'concept', prerequisiteIds: ['observe'] },
        { id: 'measure', title: 'Measure', description: 'Record a simulation.', kind: 'procedure', prerequisiteIds: ['concept'] },
        { id: 'reflect', title: 'Reflect', description: 'Reflect on evidence.', kind: 'reflection', prerequisiteIds: ['measure'] },
      ],
      phases, schedules: [schedule],
      finalDeliverableType: 'experiment_report', rubricId: 'rubric-synthetic-v2', teamId: 'synthetic-team',
      theme: { drivingQuestion: 'What changes the observed pattern?' },
      curriculum: {
        profiles: [{
          id: 'four-lessons', schedule,
          sessions: phases.map((phase, index) => ({
            id: `session-${index + 1}`, sessionIndex: index + 1,
            title: phase.title, phase: phase.phase, sessionType: phase.phase === 'guided_practice' ? 'practice' : 'theory',
            objectiveIds: phase.objectiveIds, durationMinutes: 120,
            blocks: phase.phase === 'guided_practice'
              ? { review: 10, theory: 30, check: 20, practice: 50, reflect: 10 }
              : { review: 10, theory: 60, check: 30, practice: 0, reflect: 20 },
            checkpoint: { requiredGate: phase.gateCondition },
          })),
        }],
      },
    },
    teamVersion: { teamVersionId: 'team-version-2', teamId: 'synthetic-team', leaderAssistantId: 'assistant-a', members: [{ memberId: 'member-a', assistantId: 'assistant-a' }] },
    roles: [{
      roleSlotId: 'lead', memberId: 'member-a', purposes: ['outline', 'session', 'dialogue'],
      skills: [{ canonicalId: 'tutor-guided-learning', version: '1.0.0', packageDigest: SKILL_DIGEST }],
      toolIds: ['tutor.context_packet'],
    }],
    sessionRoutes: [1, 2, 3, 4].map((sessionIndex) => ({ sessionIndex, roleSlotId: 'lead' })),
    assistants: [{
      assistantId: 'assistant-a', enabled: true, roleDefinition: 'Ask one question.', agentDefinition: 'Use evidence.',
      skillIds: ['tutor-guided-learning'], toolIds: ['tutor.context_packet'], mcpServerIds: [],
      modelByPurpose: {
        outline: { modelProviderId: 'provider-a', modelId: 'shared-name', policyVersion: 'models-v1' },
        session: { modelProviderId: 'provider-a', modelId: 'shared-name', policyVersion: 'models-v1' },
        dialogue: { modelProviderId: 'provider-a', modelId: 'shared-name', policyVersion: 'models-v1' },
      },
    }],
    skillArtifacts: [{ canonicalId: 'tutor-guided-learning', version: '1.0.0', packageDigest: SKILL_DIGEST, status: 'published', runtime: 'teaching', requiredToolIds: [] }],
    tools: [{ toolId: 'tutor.context_packet', schemaDigest: TOOL_DIGEST, handlerVersion: '1.0.0', mcpServerId: null }],
    knowledgeGrant: null,
    approval: { version: 'approval-v1', models: [{ modelProviderId: 'provider-a', modelId: 'shared-name' }], toolIds: ['tutor.context_packet'], mcpServerIds: [], imaKnowledgeBaseIds: [] },
  };
}

function changeAssistant(source: TeachingBundleSource, patch: Partial<TeachingAssistantSource>): void {
  source.assistants = source.assistants.map((assistant) => ({ ...assistant, ...patch }));
}

function imaFixture(): TeachingBundleSource {
  const source = fixture();
  const toolIds = ['ima_search_knowledge', 'ima_read_document'];
  source.roles = source.roles.map((role) => ({ ...role, toolIds }));
  changeAssistant(source, { toolIds, mcpServerIds: ['ima-knowledge'] });
  source.tools = toolIds.map((toolId) => ({ toolId, schemaDigest: TOOL_DIGEST, handlerVersion: '1.0.0', mcpServerId: 'ima-knowledge' }));
  source.approval = { ...source.approval, toolIds, mcpServerIds: ['ima-knowledge'], imaKnowledgeBaseIds: ['kb-a', 'kb-b'] };
  source.knowledgeGrant = { serverId: 'ima-knowledge', knowledgeBaseIds: ['kb-a'], allowedTools: toolIds };
  return source;
}

describe('pure teaching bundle compiler', () => {
  it('compiles actual content, exact identities and pins without writing learning facts', () => {
    const source = fixture();
    const result = compileTeachingBundle(source);
    assert.equal(result.payload.template.theme?.drivingQuestion, 'What changes the observed pattern?');
    assert.equal(result.payload.templateDigest, teachingValueDigest(source.template));
    assert.equal(result.digest, teachingValueDigest(result.payload));
    assert.equal(result.payload.roles[0]?.assistantId, 'assistant-a');
    assert.equal(result.payload.roles[0]?.skills[0]?.packageDigest, SKILL_DIGEST);
    assert.equal(result.payload.template.curriculum?.profiles[0]?.sessions[1]?.checkpoint?.requiredGate, 'TheoryMastered');
    assert.equal(result.canonicalPayload.includes('mastered":true'), false);
    assert.deepEqual(compileTeachingBundle(source), result);
  });

  it('returns a deeply frozen detached payload', () => {
    const source = fixture();
    const result = compileTeachingBundle(source);
    source.template.title = 'Changed after compilation';
    assert.equal(result.payload.template.title, 'Synthetic inquiry');
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.payload.template.objectives), true);
    assert.equal(Object.isFrozen(result.payload.roles[0]?.instructions), true);
    assert.throws(() => { result.payload.template.title = 'Not immutable'; }, TypeError);
  });

  it('normalizes route and catalog order, not teaching instruction order', () => {
    const source = fixture();
    const original = compileTeachingBundle(source);
    source.sessionRoutes = [...source.sessionRoutes].reverse();
    assert.equal(compileTeachingBundle(source).digest, original.digest);
    changeAssistant(source, { agentDefinition: 'A different teaching instruction.' });
    assert.notEqual(compileTeachingBundle(source).digest, original.digest);
  });

  it('changes digest when actual frozen template content changes, not only its ID', () => {
    const source = fixture();
    const original = compileTeachingBundle(source);
    source.template.theme = { drivingQuestion: 'A different inquiry question?' };
    const changed = compileTeachingBundle(source);
    assert.notEqual(changed.digest, original.digest);
    assert.notEqual(changed.payload.templateDigest, original.payload.templateDigest);
  });

  it('changes digest for complete skill packages and tool handlers', () => {
    const source = fixture();
    const original = compileTeachingBundle(source).digest;
    source.roles = source.roles.map((role) => ({ ...role, skills: role.skills.map((pin) => ({ ...pin, packageDigest: 'c'.repeat(64) })) }));
    source.skillArtifacts = source.skillArtifacts.map((artifact) => ({ ...artifact, packageDigest: 'c'.repeat(64) }));
    assert.notEqual(compileTeachingBundle(source).digest, original);
    const afterSkill = compileTeachingBundle(source).digest;
    source.tools = source.tools.map((tool) => ({ ...tool, handlerVersion: '2.0.0' }));
    assert.notEqual(compileTeachingBundle(source).digest, afterSkill);
  });

  it('freezes selected knowledge scope instead of all current global libraries', () => {
    const source = imaFixture();
    const original = compileTeachingBundle(source);
    source.approval = { ...source.approval, imaKnowledgeBaseIds: [...source.approval.imaKnowledgeBaseIds, 'kb-new'] };
    assert.equal(compileTeachingBundle(source).digest, original.digest);
    assert.deepEqual(original.payload.knowledgeGrant?.knowledgeBaseIds, ['kb-a']);
    source.knowledgeGrant = { serverId: 'ima-knowledge', knowledgeBaseIds: ['kb-b'], allowedTools: ['ima_search_knowledge', 'ima_read_document'] };
    assert.notEqual(compileTeachingBundle(source).digest, original.digest);
  });

  const invalidCases: readonly [string, (source: TeachingBundleSource) => void, string][] = [
    ['missing reviewed schedule', (s) => { s.scheduleProfileId = 'missing'; }, 'SCHEDULE_PROFILE_UNRESOLVED'],
    ['team from another template', (s) => { s.teamVersion.teamId = 'unrelated-team'; }, 'TEMPLATE_TEAM_MISMATCH'],
    ['route conflicting with frozen template role', (s) => { s.template.phases = s.template.phases.map((p) => ({ ...p, assignedAssistantId: 'different-assistant' })); }, 'TEMPLATE_ROLE_MISMATCH'],
    ['missing real member', (s) => { s.roles = s.roles.map((r) => ({ ...r, memberId: 'invented' })); }, 'ROLE_MEMBER_UNRESOLVED'],
    ['duplicate role', (s) => { s.roles = [...s.roles, ...s.roles]; }, 'DUPLICATE_REFERENCE'],
    ['leader outside team', (s) => { s.teamVersion.leaderAssistantId = 'invented'; }, 'TEAM_LEADER_NOT_MEMBER'],
    ['missing assistant', (s) => { s.assistants = []; }, 'ROLE_ASSISTANT_UNAVAILABLE'],
    ['disabled assistant', (s) => { changeAssistant(s, { enabled: false }); }, 'ROLE_ASSISTANT_UNAVAILABLE'],
    ['missing purpose model', (s) => { changeAssistant(s, { modelByPurpose: {} }); }, 'ROLE_MODEL_REQUIRED'],
    ['same model name from another provider', (s) => { s.approval.models = [{ modelProviderId: 'provider-b', modelId: 'shared-name' }]; }, 'MODEL_PAIR_NOT_APPROVED'],
    ['missing skill artifact', (s) => { s.skillArtifacts = []; }, 'SKILL_ARTIFACT_UNRESOLVED'],
    ['mismatched skill digest', (s) => { s.skillArtifacts = s.skillArtifacts.map((a) => ({ ...a, packageDigest: 'c'.repeat(64) })); }, 'SKILL_ARTIFACT_UNRESOLVED'],
    ['revoked skill', (s) => { s.skillArtifacts = s.skillArtifacts.map((a) => ({ ...a, status: 'revoked' })); }, 'SKILL_REVIEW_REQUIRED'],
    ['deprecated skill for a new binding', (s) => { s.skillArtifacts = s.skillArtifacts.map((a) => ({ ...a, status: 'deprecated' })); }, 'SKILL_REVIEW_REQUIRED'],
    ['development skill', (s) => { s.skillArtifacts = s.skillArtifacts.map((a) => ({ ...a, runtime: 'dev-only' })); }, 'SKILL_REVIEW_REQUIRED'],
    ['skill not granted to assistant', (s) => { changeAssistant(s, { skillIds: [] }); }, 'SKILL_ASSISTANT_GRANT_DENIED'],
    ['missing skill tool dependency', (s) => { s.skillArtifacts = s.skillArtifacts.map((a) => ({ ...a, requiredToolIds: ['unavailable'] })); }, 'SKILL_TOOL_DEPENDENCY_MISSING'],
    ['tool not granted to assistant', (s) => { changeAssistant(s, { toolIds: [] }); }, 'TOOL_GRANT_DENIED'],
    ['tool not globally approved', (s) => { s.approval.toolIds = []; }, 'TOOL_GRANT_DENIED'],
    ['missing registered tool', (s) => { s.tools = []; }, 'TOOL_ARTIFACT_UNRESOLVED'],
    ['invalid schema digest', (s) => { s.tools = s.tools.map((t) => ({ ...t, schemaDigest: 'unversioned' })); }, 'ARTIFACT_DIGEST_INVALID'],
    ['missing routes', (s) => { s.sessionRoutes = []; }, 'SESSION_ROUTE_INCOMPLETE'],
    ['fractional session', (s) => { s.sessionRoutes = [{ sessionIndex: 1.5, roleSlotId: 'lead' }]; }, 'SESSION_ROUTE_INVALID'],
    ['out of profile session', (s) => { s.sessionRoutes = [{ sessionIndex: 16, roleSlotId: 'lead' }]; }, 'SESSION_ROUTE_INVALID'],
    ['duplicate session route', (s) => { s.sessionRoutes = [...s.sessionRoutes, ...s.sessionRoutes]; }, 'DUPLICATE_REFERENCE'],
    ['invented role', (s) => { s.sessionRoutes = [{ sessionIndex: 1, roleSlotId: 'guess-by-title' }]; }, 'SESSION_ROLE_UNRESOLVED'],
  ];
  for (const [name, mutate, issue] of invalidCases) {
    it(`rejects ${name}`, () => {
      const source = fixture();
      mutate(source);
      assert.throws(() => compileTeachingBundle(source), (error: unknown) =>
        error instanceof TeachingBundleCompilationError && error.issue === issue);
    });
  }

  it('rejects domain fact writers even if incorrectly listed in a tool catalog', () => {
    const source = fixture();
    source.roles = source.roles.map((role) => ({ ...role, toolIds: ['mark_mastered'] }));
    assert.throws(() => compileTeachingBundle(source), (error: unknown) =>
      error instanceof TeachingBundleCompilationError && error.issue === 'DOMAIN_FACT_WRITE_FORBIDDEN');
  });

  const scopeCases: readonly [string, (source: TeachingBundleSource) => void, string][] = [
    ['missing project scope', (s) => { s.knowledgeGrant = null; }, 'KNOWLEDGE_SCOPE_REQUIRED'],
    ['outside KB', (s) => { s.knowledgeGrant = { serverId: 'ima-knowledge', knowledgeBaseIds: ['outside'], allowedTools: ['ima_search_knowledge'] }; }, 'KNOWLEDGE_SCOPE_DENIED'],
    ['read not granted', (s) => { s.knowledgeGrant = { serverId: 'ima-knowledge', knowledgeBaseIds: ['kb-a'], allowedTools: ['ima_search_knowledge'] }; }, 'KNOWLEDGE_TOOL_DENIED'],
    ['assistant MCP revoked', (s) => { changeAssistant(s, { mcpServerIds: [] }); }, 'MCP_GRANT_DENIED'],
    ['global MCP revoked', (s) => { s.approval.mcpServerIds = []; }, 'MCP_GRANT_DENIED'],
  ];
  for (const [name, mutate, issue] of scopeCases) {
    it(`rejects IMA ${name}`, () => {
      const source = imaFixture();
      mutate(source);
      assert.throws(() => compileTeachingBundle(source), (error: unknown) =>
        error instanceof TeachingBundleCompilationError && error.issue === issue);
    });
  }
});
