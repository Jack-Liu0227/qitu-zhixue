/* Real PostgreSQL owner checks. Only an empty disposable knowledge verification DB is accepted. */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const api = createRequire(resolve(__dirname, '../services/api/package.json'));
api('reflect-metadata');
const { createDb, closeDb } = api('@qitu/database');
const { sql } = api('drizzle-orm');
const fromApi = (path, name) => api('./.tmp/test-dist/' + path + '.js')[name];
const Center = fromApi('modules/knowledge/knowledge-center.service', 'KnowledgeCenterService');
const Matrix = fromApi('modules/knowledge/knowledge-matrix.service', 'KnowledgeMatrixService');
const Check = fromApi(
  'modules/knowledge/knowledge-connection-check.service',
  'KnowledgeConnectionCheckService',
);
const Library = fromApi('modules/knowledge/knowledge-library.service', 'KnowledgeLibraryService');
const Audit = fromApi('common/audit/audit.service', 'AuditService');
const { createImaScopeGuard } = api('./.tmp/test-dist/modules/ai-tutor/ima-tool-scope.js');
const url = process.env.QITU_KNOWLEDGE_VERIFY_DATABASE_URL;
if (!url || !/^\/qitu_knowledge_verify_[a-z0-9_]+$/.test(new URL(url).pathname))
  throw Error('Empty disposable knowledge DB required');
const db = createDb(url);
const actor = {
  id: 'fixture-admin',
  email: 'admin@example.invalid',
  role: 'admin',
  displayName: 'Fixture',
};
const checks = [];
async function verify(name, run) {
  await run();
  checks.push(name);
}
const query = async (statement) => (await db.execute(statement)).rows;
const config = {
  mcpServers: {},
  knowledgeEngines: {
    'fixture-ima': {
      name: 'Fixture ima',
      provider: 'ima',
      description: '',
      enabled: true,
      config: { allowedKnowledgeBaseIds: ['book-a', 'book-b', 'school-book'] },
    },
  },
  platformTools: {
    'project-knowledge': {
      name: '知识库检索',
      description: '',
      enabled: true,
      tools: ['knowledge_search', 'knowledge_read'],
      boundAssistants: ['mentor-a', 'mentor-b', 'disabled'],
    },
  },
};

(async () => {
  const [tables] = await query(
    sql`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`,
  );
  assert.equal(tables.n, 0, 'Refusing to change a nonempty database');
  await db.execute(
    sql.raw(`CREATE TABLE users(id text PRIMARY KEY,school_id text);
    CREATE TABLE projects(id text PRIMARY KEY,title text,student_user_id text);
    CREATE TABLE knowledge_documents(id text PRIMARY KEY,scope text,school_id text,owner_user_id text,project_id text,title text,content text,version text);
    CREATE TABLE audit_logs(id text PRIMARY KEY,actor_id text,action text,target_type text,target_id text,detail jsonb,
      idempotency_key text UNIQUE,at timestamptz NOT NULL DEFAULT now());`),
  );
  for (const migration of [
    '0019_admin_ai_config.sql',
    '0028_knowledge_center.sql',
    '0030_knowledge_connections_sources_bindings.sql',
    '0034_knowledge_library.sql',
  ]) {
    await db.execute(
      sql.raw(readFileSync(resolve(__dirname, '../database/migrations', migration), 'utf8')),
    );
  }
  await db.execute(
    sql`INSERT INTO platform_configuration_revisions(revision,config) VALUES(1,${JSON.stringify(config)}::jsonb)`,
  );
  await db.execute(
    sql`INSERT INTO admin_assistants(id,name,enabled) VALUES('mentor-a','Mentor A',true),('mentor-b','Mentor B',true),('disabled','Disabled',false)`,
  );
  await db.execute(
    sql`INSERT INTO users(id,school_id) VALUES('student','school-a'),('other','school-b')`,
  );
  for (const [id, remote] of [
    ['library-a', 'book-a'],
    ['library-b', 'book-b'],
    ['library-school', 'school-book'],
  ]) {
    await db.execute(sql`INSERT INTO knowledge_bases(id,name,kind,school_id,engine_instance_id,build_state)
      VALUES(${id},${id},${id === 'library-school' ? 'school' : 'platform'},${id === 'library-school' ? 'school-a' : null},'fixture-ima','ready')`);
    await db.execute(sql`INSERT INTO knowledge_base_connections(id,kb_id,flavour,provider,external_ref,status,last_check_at)
      VALUES(${id + '-connection'},${id},'ima','ima',${JSON.stringify({ remoteKnowledgeBaseId: remote })}::jsonb,'ready',now())`);
  }
  await db.execute(sql`INSERT INTO knowledge_base_agent_bindings(kb_id,agent_kind,agent_id,mode,enabled,created_by,updated_by)
    VALUES('library-a','runtime_agent','hidden-agent','materialize',true,'fixture','fixture'),
    ('library-a','admin_assistant','disabled','retrieve',true,'fixture','fixture')`);
  const audit = new Audit(db),
    center = new Center(db, audit),
    matrix = new Matrix(center, audit);
  const change = (id, revision, assistantId, enabled) => ({
    knowledgeBaseId: id,
    expectedRevision: revision,
    bindings: [{ assistantId, enabled }],
  });
  let nextA = 1,
    nextB = 1;

  await verify(
    'snapshot is complete, credential-free and reports disabled assistants',
    async () => {
      const value = await matrix.get();
      assert.equal(value.complete, true);
      assert.equal(value.libraries.length, 3);
      assert.equal(value.assistants.find((a) => a.id === 'disabled').enabled, false);
      assert.equal(JSON.stringify(value).includes('allowedKnowledgeBaseIds'), false);
    },
  );
  await verify('delta save preserves hidden Agent and permission-mode bindings', async () => {
    const result = await matrix.patch(
      actor,
      { changes: [change('library-a', nextA, 'mentor-a', true)] },
      'save-a',
    );
    assert.equal(result.results[0].status, 'saved');
    nextA++;
    assert.equal(
      (await query(sql`SELECT * FROM knowledge_base_agent_bindings WHERE agent_id='hidden-agent'`))
        .length,
      1,
    );
  });
  await verify('same request is idempotent and changed request cannot reuse its key', async () => {
    assert.equal(
      (await matrix.patch(actor, { changes: [change('library-a', 1, 'mentor-a', true)] }, 'save-a'))
        .results[0].status,
      'saved',
    );
    assert.equal(
      (await query(sql`SELECT revision FROM knowledge_bases WHERE id='library-a'`))[0].revision,
      nextA,
    );
    const result = await matrix.patch(
      actor,
      { changes: [change('library-a', 1, 'mentor-a', false)] },
      'save-a',
    );
    assert.equal(result.results[0].code, 'IDEMPOTENCY_CONFLICT');
  });
  await verify(
    'cross-library saves expose partial failure and do not undo successful groups',
    async () => {
      const result = await matrix.patch(
        actor,
        {
          changes: [
            change('library-a', 1, 'mentor-b', true),
            change('library-b', nextB, 'mentor-a', true),
          ],
        },
        'partial',
      );
      assert.equal(result.results[0].code, 'KNOWLEDGE_BINDING_CONFLICT');
      assert.equal(result.results[1].status, 'saved');
      nextB++;
    },
  );
  await verify('concurrent edits of one revision cannot both succeed', async () => {
    const results = await Promise.all(
      ['x', 'y'].map((key) =>
        matrix.patch(
          actor,
          { changes: [change('library-b', nextB, 'mentor-b', true)] },
          'parallel-' + key,
        ),
      ),
    );
    assert.equal(results.flatMap((r) => r.results).filter((r) => r.status === 'saved').length, 1);
    nextB++;
  });
  await verify(
    'disabled and removed assistants can be revoked without granting them new access',
    async () => {
      const result = await matrix.patch(
        actor,
        {
          changes: [
            {
              knowledgeBaseId: 'library-a',
              expectedRevision: nextA,
              bindings: [
                { assistantId: 'disabled', enabled: false },
                { assistantId: 'deleted-assistant', enabled: false },
              ],
            },
          ],
        },
        'revoke-disabled',
      );
      assert.equal(result.results[0].status, 'saved');
      nextA++;
      assert.equal(
        (
          await matrix.patch(
            actor,
            { changes: [change('library-a', nextA, 'disabled', true)] },
            'grant-disabled',
          )
        ).results[0].status,
        'failed',
      );
    },
  );
  await verify('audit failure rolls back binding and revision together', async () => {
    const failing = new Matrix(center, {
      write: async () => {
        throw Error('Fixture audit outage');
      },
    });
    assert.equal(
      (
        await failing.patch(
          actor,
          { changes: [change('library-a', nextA, 'mentor-b', true)] },
          'audit-fail',
        )
      ).results[0].status,
      'failed',
    );
    assert.equal(
      (await query(sql`SELECT revision FROM knowledge_bases WHERE id='library-a'`))[0].revision,
      nextA,
    );
    assert.equal(
      (
        await query(
          sql`SELECT * FROM knowledge_base_agent_bindings WHERE kb_id='library-a' AND agent_id='mentor-b'`,
        )
      ).length,
      0,
    );
  });
  await verify('IMA scope uses per-library grants, object scope and live revocation', async () => {
    await matrix.patch(
      actor,
      { changes: [change('library-school', 1, 'mentor-a', true)] },
      'school-grant',
    );
    assert.deepEqual((await center.imaKnowledgeBaseIds('mentor-a', 'student')).sort(), [
      'book-a',
      'book-b',
      'school-book',
    ]);
    assert.deepEqual((await center.imaKnowledgeBaseIds('mentor-a', 'other')).sort(), [
      'book-a',
      'book-b',
    ]);
    const guard = createImaScopeGuard({
      knowledgeBaseIds: () => center.imaKnowledgeBaseIds('mentor-a', 'student'),
    });
    await guard.before('ima_search_knowledge', { knowledge_base_id: 'book-a' });
    await guard.after(
      'ima_search_knowledge',
      'book-a',
      JSON.stringify({ items: [{ document_ref: 'fixture-ref' }] }),
    );
    assert.equal(
      (
        await matrix.patch(
          actor,
          { changes: [change('library-a', nextA, 'mentor-a', false)] },
          'revoke-a',
        )
      ).results[0].status,
      'saved',
    );
    nextA++;
    for (const tool of ['ima_search_knowledge', 'ima_list_documents'])
      await assert.rejects(guard.before(tool, { knowledge_base_id: 'book-a' }));
    await assert.rejects(guard.before('ima_read_document', { document_ref: 'fixture-ref' }));
    const listed = JSON.parse(
      await guard.after(
        'ima_list_knowledge_bases',
        null,
        JSON.stringify({ knowledge_bases: [{ knowledge_base_id: 'book-a' }] }),
      ),
    );
    assert.deepEqual(listed.knowledge_bases, []);
    await assert.rejects(guard.after('ima_search_knowledge', 'book-a', '{"items":[]}'));
  });
  await verify('disabled library is removed from current IMA ceiling', async () => {
    const library = new Library(center, audit, {});
    await library.manage(
      actor,
      'library-b',
      { expectedRevision: nextB, enabled: false },
      'disable-library',
    );
    nextB++;
    assert.equal(
      (await center.imaKnowledgeBaseIds('mentor-a', 'student')).includes('book-b'),
      false,
    );
    assert.equal(await center.canRetrieve('mentor-a', 'library-b'), false);
  });
  const engine = {
    adapterFor: () => ({ connect: async () => ({ ok: true, status: 'ready' }) }),
    execute: async (_, request) =>
      request.externalRef.remoteKnowledgeBaseId === 'invalid'
        ? { ok: false, errorCode: 'IMA_KB_ID_INVALID' }
        : { ok: true, status: 'ready', manifest: { items: [] } },
  };
  const connection = new Check(center, engine, audit);
  await verify('failed relink keeps previous connection and frozen semantics', async () => {
    await assert.rejects(
      connection.run(
        actor,
        'library-a',
        { expectedRevision: nextA, remoteKnowledgeBaseId: 'invalid' },
        'invalid-relink',
        true,
      ),
    );
    assert.equal(
      (
        await query(
          sql`SELECT external_ref FROM knowledge_base_connections WHERE kb_id='library-a'`,
        )
      )[0].external_ref.remoteKnowledgeBaseId,
      'book-a',
    );
  });
  await verify(
    'explicit relink keeps local identity and bindings, invalidates old citations and replays safely',
    async () => {
      await db.execute(sql`INSERT INTO knowledge_remote_evidence(id,kb_id,assistant_id,fingerprint,title,content,origin,expires_at)
      VALUES('fixture-citation','library-a','mentor-a','old','Fixture','Synthetic only','{}',now()+interval '1 hour')`);
      const body = { expectedRevision: nextA, remoteKnowledgeBaseId: 'new-book' };
      const receipt = await connection.run(actor, 'library-a', body, 'relink', true);
      assert.equal(receipt.ok, true);
      nextA++;
      assert.equal(
        (await query(sql`SELECT count(*)::int n FROM knowledge_remote_evidence`))[0].n,
        0,
      );
      assert.equal(
        (
          await query(
            sql`SELECT * FROM knowledge_base_agent_bindings WHERE agent_id='hidden-agent'`,
          )
        ).length,
        1,
      );
      assert.deepEqual(await connection.run(actor, 'library-a', body, 'relink', true), receipt);
      // Relink cannot restore the previously revoked assistant grant.
      assert.equal(
        (await center.imaKnowledgeBaseIds('mentor-a', 'student')).includes('new-book'),
        false,
      );
    },
  );
  console.log(JSON.stringify({ passed: checks.length, failed: 0, checks }, null, 2));
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closeDb(db));
