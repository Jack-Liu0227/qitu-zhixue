/* End-to-end library acceptance with the real embedding service and native DeepTutor index. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const api = createRequire(path.resolve(__dirname, '../services/api/package.json'));
api('reflect-metadata');
const { createDb, closeDb } = api('@qitu/database');
const { sql } = api('drizzle-orm');
const root = './.tmp/test-dist/';
const moduleClass = (name, cls) => api(root + 'modules/knowledge/' + name + '.js')[cls];
const Center = moduleClass('knowledge-center.service', 'KnowledgeCenterService');
const Engine = moduleClass('knowledge-engine.service', 'KnowledgeEngineService');
const Library = moduleClass('knowledge-library.service', 'KnowledgeLibraryService');
const Connection = moduleClass('knowledge-connection.service', 'KnowledgeConnectionService');
const Probe = moduleClass('knowledge-link-probe.service', 'KnowledgeLinkProbeService');
const Worker = moduleClass('knowledge-build.worker', 'KnowledgeBuildWorker');
const Retrieval = moduleClass('knowledge-retrieval.service', 'KnowledgeRetrievalService');
const { AuditService } = api(root + 'common/audit/audit.service.js');
const connection = process.env.QITU_KNOWLEDGE_VERIFY_DATABASE_URL;
if (!connection || !new URL(connection).pathname.startsWith('/qitu_knowledge_verify_'))
  throw Error('Disposable database required');
const db = createDb(connection);
const suffix = randomUUID().slice(0, 8);
const checks = [];
const actor = {
  id: 'library-admin-' + suffix,
  role: 'admin',
  email: 'verify-' + suffix + '@example.invalid',
  displayName: '验收管理员',
};
const student = 'library-student-' + suffix;
const assistants = ['library-tutor-a-' + suffix, 'library-tutor-b-' + suffix];
(async () => {
  for (const [id, role] of [
    [actor.id, 'admin'],
    [student, 'student'],
  ])
    await db.execute(
      sql`INSERT INTO users(id,email,display_name,role,password_hash) VALUES(${id},${id + '@example.invalid'},'Verification',${role},'disabled')`,
    );
  for (const id of assistants)
    await db.execute(sql`INSERT INTO admin_assistants(id,name,enabled) VALUES(${id},${id},true)`);
  await db.execute(
    sql`INSERT INTO model_providers(id,name,base_url,api) VALUES('qitu-local','Local embedding','http://127.0.0.1:4115/v1','openai-completions') ON CONFLICT DO NOTHING`,
  );
  await db.execute(
    sql`INSERT INTO model_models(provider_id,model_id,display_name,input_modalities,output_modalities,source) VALUES('qitu-local','bge-small-zh-v1.5','Chinese embedding','["text"]','["embedding"]','manual') ON CONFLICT(provider_id,model_id) DO UPDATE SET output_modalities=excluded.output_modalities`,
  );
  const audit = new AuditService(db);
  const center = new Center(db, audit);
  let snap = await center.configuration();
  const config = structuredClone(snap.config);
  config.knowledgeEngines['library-llama'] = {
    name: '验收本地引擎',
    description: 'BGE + DeepTutor',
    provider: 'llamaindex',
    enabled: true,
    config: {
      embeddingModelRef: 'qitu-local:bge-small-zh-v1.5',
      retrieval_profile: 'hybrid',
      top_k: 5,
    },
  };
  config.platformTools['project-knowledge'].enabled = true;
  await center.save(actor, { config, expectedRevision: snap.revision }, 'config-' + suffix);
  const engine = new Engine(center, {
    resolveRuntimeTargetByModel: () => ({
      providerId: 'qitu-local',
      modelId: 'bge-small-zh-v1.5',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:4115/v1',
      credential: process.env.QITU_LOCAL_EMBEDDING_TOKEN,
      input: ['text'],
      output: ['embedding'],
    }),
  });
  const library = new Library(center, audit, engine);
  const probe = new Probe(center, engine);
  const connect = new Connection(center, engine, probe, audit);
  const request = {
    name: '验收动能教材 ' + suffix,
    engineInstanceId: 'library-llama',
    mode: 'create_new',
    embeddingModelRef: 'qitu-local:bge-small-zh-v1.5',
  };
  let base = await connect.createBase(actor, request, 'new-' + suffix);
  assert.equal((await connect.createBase(actor, request, 'new-' + suffix)).id, base.id);
  await assert.rejects(connect.createBase(actor, { ...request, name: 'changed' }, 'new-' + suffix));
  assert.equal(base.library_settings.engineOverrides.embeddingModelRef, request.embeddingModelRef);
  checks.push('new library, fixed embedding model and idempotency');
  const bindings = assistants.map((agentId) => ({
    agentKind: 'admin_assistant',
    agentId,
    mode: 'retrieve',
    enabled: true,
  }));
  assert.ok((await center.baseBindings(base.id)).catalog.some((a) => a.agentId === assistants[0]));
  await center.saveBaseBindings(
    actor,
    base.id,
    { expectedRevision: base.revision, bindings },
    'bind-' + suffix,
  );
  for (const id of assistants) assert.equal(await center.canRetrieve(id, base.id), true);
  checks.push('two assistants bound and global capability synchronized');
  base = await center.base(base.id);
  const folderBody = { expectedRevision: base.revision, createFolder: '教材/物理' };
  await library.manage(actor, base.id, folderBody, 'folder-' + suffix);
  await library.manage(actor, base.id, folderBody, 'folder-' + suffix);
  await assert.rejects(
    library.manage(actor, base.id, { ...folderBody, name: 'wrong' }, 'folder-' + suffix),
  );
  await assert.rejects(
    library.manage(actor, base.id, { expectedRevision: 1, name: 'stale' }, 'stale-' + suffix),
  );
  base = await center.addFile(
    actor,
    base.id,
    {
      title: '动能与速度',
      content:
        '动能是运动物体具有的能量。动能公式 E_k=1/2*m*v^2。质量不变，速度变为原来的两倍，动能变为原来的四倍。',
    },
    'text-' + suffix,
  );
  await library.manage(
    actor,
    base.id,
    {
      expectedRevision: base.revision,
      moveFile: { memberId: base.files[0].id, folder: '教材/物理' },
    },
    'move-' + suffix,
  );
  base = await center.base(base.id);
  assert.equal(base.files[0].origin.folder, '教材/物理');
  checks.push('persistent folders, move, revision conflict and replay');
  await center.rebuild(base.id, 'build-' + suffix);
  const worker = new Worker(center, engine, {});
  // The cloned database can contain historical queued jobs; cancel only those copied jobs.
  await db.execute(
    sql`UPDATE knowledge_jobs SET state='cancelled' WHERE kb_id<>${base.id} AND state NOT IN ('ready','empty','failed','cancelled')`,
  );
  await worker.tick();
  base = await center.base(base.id);
  assert.equal(
    base.build_state,
    'ready',
    JSON.stringify({
      state: base.build_state,
      jobs: base.jobs.map((j) => ({ state: j.state, error: j.error_code })),
    }),
  );
  const retrieval = new Retrieval(center, engine);
  for (const id of assistants) {
    const found = await retrieval.search(student, id, '速度变为两倍，动能怎样变化？');
    assert.equal(found.state, 'ready');
    assert.match((await retrieval.read(student, id, found.evidence[0].citationId)).text, /四倍/);
  }
  checks.push('real BGE embedding, original DeepTutor build, both assistants retrieve and read');
  const nativeName = 'kb_' + createHash('sha256').update(base.id).digest('hex').slice(0, 24);
  const externalPath = path.join(
    process.env.QITU_KNOWLEDGE_DATA,
    base.id,
    base.active_index_version_id,
    nativeName,
  );
  fs.mkdirSync(path.join(externalPath, 'raw'), { recursive: true });
  fs.writeFileSync(
    path.join(externalPath, 'raw', 'physics.txt'),
    '质量不变时，速度两倍，动能四倍。',
  );
  const linked = await connect.createBase(
    actor,
    {
      name: '关联原生索引 ' + suffix,
      engineInstanceId: 'library-llama',
      mode: 'link_existing',
      connection: { externalPath, ragProvider: 'llamaindex' },
    },
    'linked-' + suffix,
  );
  assert.equal(linked.connection.status, 'ready');
  const docs = await library.documents(linked.id);
  assert.equal(docs.items[0].title, 'physics.txt');
  assert.match((await library.document(linked.id, docs.items[0].id)).content, /四倍/);
  await assert.rejects(library.document(linked.id, 'unknown'));
  await center.saveBaseBindings(
    actor,
    linked.id,
    { expectedRevision: linked.revision, bindings: [bindings[0]] },
    'linked-bind-' + suffix,
  );
  await center.saveBaseBindings(
    actor,
    base.id,
    { expectedRevision: base.revision, bindings: [] },
    'unbind-' + suffix,
  );
  const found = await retrieval.search(student, assistants[0], '速度两倍动能');
  assert.equal(found.state, 'ready');
  assert.equal(found.evidence[0].knowledgeBaseId, linked.id);
  const citation = found.evidence[0].citationId;
  assert.match((await retrieval.read(student, assistants[0], citation)).text, /四倍/);
  assert.equal((await retrieval.search(student, assistants[1], '动能')).evidence.length, 0);
  checks.push(
    'native existing index mounted without rebuild, source browsing and bound-only retrieval',
  );
  const fresh = await center.base(linked.id);
  await library.manage(
    actor,
    linked.id,
    { expectedRevision: fresh.revision, deleted: true },
    'delete-' + suffix,
  );
  assert.ok(fs.existsSync(externalPath));
  await assert.rejects(retrieval.read(student, assistants[0], citation));
  checks.push('delete revokes citations and preserves external index');
  console.log(JSON.stringify({ status: 'PASS', checks }));
})()
  .finally(() => closeDb(db))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
