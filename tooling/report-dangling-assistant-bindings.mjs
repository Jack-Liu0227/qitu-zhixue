#!/usr/bin/env node
/** Read-only report of assistant bindings that no longer resolve to runtime assets. */
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { Client } = require('../services/api/node_modules/pg');
const { loadTutorRuntimeSource } = require('../services/api/dist/common/tutor-runtime/runtime-source.js');
const { builtinToolRegistry } = require('../services/api/dist/modules/platform-registry/built-in-tools.js');

const databaseName = process.env.QITU_RESTORE_DATABASE;
if (!process.env.DATABASE_URL && (!databaseName || !/^[a-z][a-z0-9_]{0,62}$/.test(databaseName))) {
  throw new Error('Explicit DATABASE_URL or QITU_RESTORE_DATABASE is required');
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

async function report(client) {
  const [{ rows: assistants }, { rows: mcpServers }] = await Promise.all([
    client.query('SELECT id, enabled_skills, tool_ids, mcp_server_ids FROM admin_assistants ORDER BY id'),
    client.query('SELECT id FROM runtime_mcp_servers'),
  ]);
  const runtime = loadTutorRuntimeSource();
  const knownSkills = new Set(runtime.skills.map((skill) => skill.id));
  const knownTools = new Set(builtinToolRegistry.list().map((tool) => tool.id));
  const knownMcpServers = new Set(mcpServers.map((server) => server.id));

  return assistants.flatMap((assistant) => {
    const unknownSkillIds = list(assistant.enabled_skills).filter((id) => !knownSkills.has(id));
    const unknownToolIds = list(assistant.tool_ids).filter((id) => !knownTools.has(id));
    const unknownMcpServerIds = list(assistant.mcp_server_ids).filter((id) => !knownMcpServers.has(id));
    return unknownSkillIds.length || unknownToolIds.length || unknownMcpServerIds.length
      ? [{ assistantId: assistant.id, unknownSkillIds, unknownToolIds, unknownMcpServerIds }]
      : [];
  });
}

function printHuman(items) {
  if (items.length === 0) {
    console.log('No dangling assistant bindings found.');
    return;
  }
  for (const item of items) {
    console.log(`Assistant ${item.assistantId}`);
    if (item.unknownSkillIds.length) console.log(`  unknown skills: ${item.unknownSkillIds.join(', ')}`);
    if (item.unknownToolIds.length) console.log(`  unknown tools: ${item.unknownToolIds.join(', ')}`);
    if (item.unknownMcpServerIds.length) console.log(`  unknown MCP servers: ${item.unknownMcpServerIds.join(', ')}`);
  }
}

const client = new Client(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : { host: '/var/run/postgresql', user: 'postgres', database: databaseName });
try {
  await client.connect();
  const items = await report(client);
  if (process.argv.includes('--json')) console.log(JSON.stringify(items, null, 2));
  else printHuman(items);
} finally {
  await client.end();
}
