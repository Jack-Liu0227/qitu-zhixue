/* Real local-model acceptance against a disposable database, never production. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const api = createRequire(path.resolve(__dirname, '../services/api/package.json'));
api('reflect-metadata');
const { createDb, closeDb } = api('@qitu/database');
const { sql } = api('drizzle-orm');
const root = './.tmp/test-dist/';
const { KnowledgeCenterService } = api(root + 'modules/knowledge/knowledge-center.service.js');
const { KnowledgeEngineService } = api(root + 'modules/knowledge/knowledge-engine.service.js');
const { KnowledgeBuildWorker } = api(root + 'modules/knowledge/knowledge-build.worker.js');
const { ProjectKnowledgeService } = api(root + 'modules/knowledge/project-knowledge.service.js');
const { PostgresExplorationStore } = api(root + 'modules/projects/exploration.store.postgres.js');
const { AuditService } = api(root + 'common/audit/audit.service.js');
const connection = process.env.QITU_KNOWLEDGE_VERIFY_DATABASE_URL;
if (!connection || !new URL(connection).pathname.startsWith('/qitu_knowledge_verify_'))
  throw new Error('Disposable verification database required');
const token = process.env.QITU_LOCAL_EMBEDDING_TOKEN;
if (!token) throw new Error('Local embedding service token required');
const db = createDb(connection);
const suffix = randomUUID().slice(0, 8);
const student = 'local-student-' + suffix;
const assistant = 'local-tutor-' + suffix;
const actor = {
  id: 'local-admin-' + suffix,
  role: 'admin',
  displayName: 'Verification',
  email: 'local-admin-' + suffix + '@example.invalid',
};
(async () => {
  for (const [id, role] of [
    [actor.id, 'admin'],
    [student, 'student'],
  ])
    await db.execute(
      sql`INSERT INTO users(id,email,display_name,role,password_hash) VALUES(${id},${id + '@example.invalid'},'Verification',${role},'disabled')`,
    );
  await db.execute(
    sql`INSERT INTO admin_assistants(id,name,enabled) VALUES(${assistant},'Verification tutor',true)`,
  );
  await db.execute(
    sql`INSERT INTO model_providers(id,name,base_url,api) VALUES('qitu-local','Local embedding','http://127.0.0.1:4115/v1','openai-completions') ON CONFLICT DO NOTHING`,
  );
  await db.execute(
    sql`INSERT INTO model_models(provider_id,model_id,display_name,input_modalities,output_modalities,source) VALUES('qitu-local','bge-small-zh-v1.5','Chinese embedding','["text"]','["embedding"]','manual') ON CONFLICT DO NOTHING`,
  );
  const center = new KnowledgeCenterService(db, new AuditService(db));
  const snapshot = await center.configuration();
  const config = structuredClone(snapshot.config);
  config.knowledgeEngines['llamaindex-main'] = {
    name: '本地中文知识引擎',
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
  config.platformTools['project-knowledge'].boundAssistants = [assistant];
  await center.save(
    actor,
    { config, expectedRevision: snapshot.revision },
    'local-config-' + suffix,
  );
  const resolver = {
    resolveRuntimeTargetByModel: () => ({
      providerId: 'qitu-local',
      modelId: 'bge-small-zh-v1.5',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:4115/v1',
      credential: token,
      input: ['text'],
      output: ['embedding'],
    }),
  };
  const engine = new KnowledgeEngineService(center, resolver);
  const preflight = await engine.check('llamaindex-main');
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  let source = await center.createBase(
    actor,
    { name: '动能教学资料 ' + suffix, engineInstanceId: 'llamaindex-main' },
    'local-source-' + suffix,
  );
  if (process.env.QITU_KNOWLEDGE_VERIFY_UPLOAD_PATH) {
    const fs = require('node:fs');
    const { KnowledgeUploadService } = api(root + 'modules/knowledge/knowledge-upload.service.js');
    const upload = new KnowledgeUploadService(center);
    const bytes = fs.readFileSync(process.env.QITU_KNOWLEDGE_VERIFY_UPLOAD_PATH);
    const body = {
      fileName: path.basename(process.env.QITU_KNOWLEDGE_VERIFY_UPLOAD_PATH),
      base64: bytes.toString('base64'),
      allowMaterialize: true,
    };
    source = await upload.upload(actor, source.id, body, 'local-file-' + suffix);
    const replay = await upload.upload(actor, source.id, body, 'local-file-' + suffix);
    assert.equal(replay.files.length, 1, 'binary upload replay is idempotent');
    const original = await center.original(source.id, source.files[0].id);
    assert.deepEqual(original.body, bytes, 'original bytes preserved');
    await assert.rejects(
      upload.upload(
        actor,
        source.id,
        { ...body, base64: Buffer.from('bad document').toString('base64') },
        'bad-file-' + suffix,
      ),
    );
    assert.equal((await center.base(source.id)).files.length, 1, 'parse failure creates no member');
  } else {
    source = await center.addFile(
      actor,
      source.id,
      {
        title: '动能与速度的关系',
        content:
          '动能是物体由于运动而具有的能量。动能公式为 E_k=1/2*m*v^2，其中 m 为质量，v 为速度。在质量不变时，速度变为原来的两倍，动能变为原来的四倍。',
        allowMaterialize: true,
      },
      'local-file-' + suffix,
    );
  }
  const store = new PostgresExplorationStore(db);
  const now = new Date();
  const exploration = 'local-exploration-' + suffix;
  const project = 'local-project-' + suffix;
  await store.createExploration({
    id: exploration,
    studentId: student,
    source: 'free',
    templateVersionId: null,
    intentDraftId: 'local-intent-' + suffix,
    now,
  });
  assert.equal(
    (
      await center.query(
        sql`SELECT count(*)::int n FROM knowledge_bases WHERE owner_user_id=${student}`,
      )
    )[0].n,
    0,
    'no formal knowledge base before confirmation',
  );
  await store.persistConfirmation({
    explorationId: exploration,
    confirmedAt: now,
    confirmedDraft: {
      goalUser: '研究动能',
      coreInterests: ['动能'],
      preferredForm: '实验',
      targetBeneficiary: '同学',
    },
    project: {
      id: project,
      studentId: student,
      templateVersionId: null,
      status: 'initiating',
      currentStageIndex: 0,
      stageTotal: 4,
      progressPercent: 0,
      title: '动能研究',
      subtitle: null,
      tags: ['动能'],
    },
  });
  const knowledge = new ProjectKnowledgeService(center, engine);
  let status = await knowledge.status(student, project);
  assert.equal(status.name, '动能研究知识库');
  assert.ok(status.jobId);
  const worker = new KnowledgeBuildWorker(center, engine, {
    discover: async () => ({ imported: 0, failures: 0, catalogComplete: true }),
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    await worker.tick();
    status = await knowledge.status(student, project);
    if (status.state === 'ready') break;
  }
  assert.equal(status.state, 'ready', JSON.stringify(await center.base(status.knowledgeBaseId)));
  const result = await knowledge.search(
    student,
    project,
    assistant,
    '速度变为两倍，动能如何变化？',
  );
  assert.equal(result.state, 'ready');
  assert.ok(result.evidence.length);
  const citation = result.evidence[0].citationId;
  const read = await knowledge.read(student, project, assistant, citation);
  assert.match(read.text, /四倍/);
  assert.ok(read.origin.sourceMemberId);
  await assert.rejects(knowledge.search('foreign-student', project, assistant, '动能'));
  await center.updateFile(actor, source.id, source.files[0].id, { allowMaterialize: false });
  assert.equal((await knowledge.search(student, project, assistant, '动能')).evidence.length, 0);
  await assert.rejects(knowledge.read(student, project, assistant, citation));
  const bound = await center.base(status.knowledgeBaseId);
  assert.equal(
    bound.active_index_version_id,
    status.activeIndexVersionId,
    'revocation does not erase historical version',
  );
  console.log(
    JSON.stringify({
      status: 'PASS',
      model: 'bge-small-zh-v1.5',
      dimensions: 512,
      binaryUpload: !!process.env.QITU_KNOWLEDGE_VERIFY_UPLOAD_PATH,
      checks: [
        'actual embedding preflight',
        'confirmation atomically creates project+base+binding+job',
        'original DeepTutor build and validation',
        'project-only Chinese semantic retrieval',
        'original full text citation',
        'foreign project denial',
        'source revocation blocks search and read',
        'historical index retained',
      ],
    }),
  );
})()
  .finally(() => closeDb(db))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
