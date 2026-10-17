#!/usr/bin/env node
/** Register the four historical UI manifests without granting access or inventing connections.
 * Run with an explicit QITU_RESTORE_DATABASE (local PostgreSQL peer auth), or DATABASE_URL.
 */
const { Client } = require('../services/api/node_modules/pg');
const { createHash, randomUUID } = require('node:crypto');
const {
  LEGACY_MCP_MANIFESTS,
} = require('../services/api/dist/modules/platform-registry/legacy-mcp-catalog.js');
async function restore(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(281017)');
    const {
      rows: [latest],
    } = await client.query(
      'SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1',
    );
    if (!latest?.config?.mcpServers)
      throw new Error('Initialize the knowledge-center configuration before restoring MCP entries');
    const config = structuredClone(latest.config);
    const registered = [];
    const configured = [];
    for (const manifest of LEGACY_MCP_MANIFESTS) {
      const inserted = await client.query(
        `INSERT INTO runtime_mcp_servers(id,label,transport,description,tool_ids,enabled,status)
        VALUES($1,$2,'stdio',$3,$4::jsonb,false,'not_configured') ON CONFLICT(id) DO NOTHING RETURNING id`,
        [
          manifest.id,
          manifest.name,
          manifest.description,
          JSON.stringify(manifest.tools.map((t) => t.name)),
        ],
      );
      if (inserted.rowCount) registered.push(manifest.id);
      const {
        rows: [row],
      } = await client.query('SELECT * FROM runtime_mcp_servers WHERE id=$1', [manifest.id]);
      if (!Object.hasOwn(config.mcpServers, manifest.id)) {
        config.mcpServers[manifest.id] = {
          name: row.label,
          enabled: row.enabled,
          transport: row.transport,
          tools: row.tool_ids,
        };
        configured.push(manifest.id);
      }
    }
    let revision = latest.revision;
    if (configured.length) {
      revision++;
      await client.query(
        `INSERT INTO platform_configuration_revisions(revision,parent_revision,config,idempotency_key,request_hash)
        VALUES($1,$2,$3::jsonb,$4,$5)`,
        [
          revision,
          latest.revision,
          JSON.stringify(config),
          `restore-legacy-mcp-v1:${revision}`,
          createHash('sha256').update(JSON.stringify(config)).digest('hex'),
        ],
      );
    }
    if (registered.length || configured.length)
      await client.query(
        `INSERT INTO audit_logs(id,action,target_type,target_id,detail,idempotency_key)
      VALUES($1,'operator.mcp.restore-catalog','platform_configuration',$2,$3::jsonb,$4)`,
        [
          randomUUID(),
          String(revision),
          JSON.stringify({
            registered,
            configured,
            connectionsProbed: false,
            permissionsChanged: false,
            modelsChanged: false,
          }),
          `restore-legacy-mcp-v1:${revision}`,
        ],
      );
    await client.query('COMMIT');
    return { revision, registered: registered.length, configured: configured.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
module.exports = { restore };
if (require.main === module) {
  const database = process.env.QITU_RESTORE_DATABASE;
  if (!process.env.DATABASE_URL && (!database || !/^[a-z][a-z0-9_]{0,62}$/.test(database)))
    throw new Error('Explicit DATABASE_URL or QITU_RESTORE_DATABASE is required');
  const client = new Client(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : { host: '/var/run/postgresql', user: 'postgres', database },
  );
  (async () => {
    try {
      await client.connect();
      console.log(JSON.stringify(await restore(client)));
    } finally {
      await client.end();
    }
  })().catch(() => {
    console.error(
      'MCP catalog restore failed; transaction rolled back. Inspect database availability and configuration.',
    );
    process.exitCode = 1;
  });
}
