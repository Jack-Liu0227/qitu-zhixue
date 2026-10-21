import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TutorService } from './tutor.service';
import { InMemoryTutorSessionStore } from './tutor-session.store';
import { configurationBindingFixture } from '../templates/configuration-binding.test-fixture';

class DurableFixture extends InMemoryTutorSessionStore { override readonly durable: boolean = true; }

test('exploration team graph checks both owners and reads runtime only in this session', async () => {
  const store = new InMemoryTutorSessionStore();
  await store.create({sessionId:'exploration-owned',ownerId:'owner',partnerId:'mentor',projectId:null,explorationId:'owned',source:'exploration',createdAt:new Date().toISOString()});
  const tutor = new TutorService('test', { complete: async () => { throw Error('graph must not invoke a model'); } }, undefined, undefined, undefined, store);
  const calls: unknown[][] = [];
  Object.assign(tutor, {
    projects: { getExploration: async (ownerId:string,id:string) => {
      if (ownerId !== 'owner' || id !== 'owned') throw Error('exploration access denied');
      return {id,templateVersionId:'version'};
    } },
    explorationHandoff: async () => ({team:{teamId:'published',teamName:'Actual team',assistantId:'mentor',assistantName:'Actual mentor'},
      teamConfig:{enabled:true,members:[{slotId:'slot',assistantId:'mentor',assistantName:'Actual mentor',role:'leader'}]}}),
    platformRegistry:{listAssistants:async()=>[{id:'mentor',enabled:true}]},
    teamRuntime:{getStudentTeamRuntimeProjection:async(...args:unknown[])=>{calls.push(args);return{runId:'scoped-run',agents:{mentor:{status:'running',messages:[],toolCalls:[]}}};}},
  });
  const graph=await tutor.getTeamGraph(undefined,'owner','owned');
  assert.equal(graph.agents[0]?.status,'running');
  assert.equal(calls[0]?.[0],null);assert.equal(calls[0]?.[1],'owner');assert.equal(calls[0]?.[3],'exploration-owned');
  await assert.rejects(tutor.getTeamGraph(undefined,'other','owned'),/access denied/);
  await assert.rejects(tutor.getTeamGraph(undefined,'owner','foreign'),/access denied/);
  assert.equal(calls.length,1);
});

test('an explicit exploration stays in its own context when a continued project exists', async () => {
  const tutor = new TutorService('live', { complete: async () => { throw Error('context must not invoke model'); } },
    undefined, undefined, undefined, new DurableFixture());
  Object.assign(tutor, {
    learningStore: { findProject: async () => { throw Error('must not switch to the continued project'); } },
    projectHistory: { currentSelection: async () => { throw Error('explicit exploration takes precedence'); } },
    projects: { getExploration: async (ownerId: string, id: string) => {
      assert.equal(ownerId, 'owner');
      if (id !== 'owned-exploration') throw Error('exploration access denied');
      return { id, source: 'free', templateVersionId: null, status: 'exploring' };
    } },
  });
  const context = await tutor.getProjectContext(undefined, 'owner', true, 'owned-exploration');
  assert.equal(context?.project, null);
  assert.equal(context?.exploration?.id, 'owned-exploration');
  await assert.rejects(tutor.getProjectContext(undefined, 'owner', true, 'foreign-exploration'), /access denied/);
});

test('free exploration persists an inviting opening once without a model, project or learning facts', async () => {
  const store = new DurableFixture();
  const make = () => new TutorService('live', { complete: async () => { throw Error('no model for an opening'); } },
    undefined, undefined, undefined, store);
  const first = await make().resolveSession(null, 'synthetic-owner');
  const second = await make().resolveSession(null, 'synthetic-owner');
  assert.equal(first.projectId, null);
  assert.equal(first.turns.length, 1);
  assert.deepEqual(first.turns, second.turns);
  assert.ok(first.turns[0]!.blocks.some(block => block.kind === 'options' && block.items.length === 3));
  assert.equal(first.turns[0]!.stageAfter, 'exploration');
  assert.equal(first.turns[0]!.evidenceRef, null);
  assert.equal(first.turns.some(turn => turn.blocks.some(block => block.kind === 'optics_experiment')), false);
});

test('exploration binding requires published validated configuration and never freezes a project', async () => {
  const h = await configurationBindingFixture();
  const preview = () => h.bindings.getExplorationBinding('synthetic-owner', 'configuration-version');
  assert.equal((await preview()).binding, null);
  await h.activate();
  const ready = await preview();
  assert.equal(ready.binding?.id, h.binding.id);
  assert.equal(ready.bundle?.teamVersion.teamVersionId, h.team.id);
  assert.equal(await h.store.findSnapshot('synthetic-project'), null);
  await assert.rejects(h.bindings.getExplorationBinding('synthetic-owner', 'unavailable-version'));
  h.team.enabled = false;
  h.store.seedTeamVersion(h.team);
  assert.equal((await preview()).binding, null);
});

test('history reads require both project and session ownership and cannot create or resume teaching', async () => {
  const store = new DurableFixture();
  const tutor = new TutorService('live', { complete: async () => { throw Error('history must not invoke model'); } },
    undefined, undefined, undefined, store);
  Object.assign(tutor, { learningStore: { findProject: async () => ({ studentId: 'owner' }) } });
  assert.equal(await tutor.getProjectConversationHistory('legacy-project', 'owner'), null);
  assert.equal(await store.findByProject('legacy-project'), null);
  await store.create({ sessionId: 'old-session', projectId: 'legacy-project', explorationId: null,
    ownerId: 'owner', partnerId: 'old-assistant', source: 'project', createdAt: new Date().toISOString() });
  const history = await tutor.getProjectConversationHistory('legacy-project', 'owner');
  assert.equal(history?.sessionId, 'old-session');
  assert.equal(history?.lastSeq, 0);
  await assert.rejects(tutor.getProjectConversationHistory('legacy-project', 'other-owner'));
  Object.assign(tutor, { learningStore: { findProject: async () => ({ studentId: 'other-owner' }) } });
  await assert.rejects(tutor.getProjectConversationHistory('legacy-project', 'other-owner'));
});
