import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadEnvironment } from './config.js';

async function main() {
  loadEnvironment();
  const settings = loadConfig(process.env);
  const directory = fileURLToPath(new URL('../../.runtime/clients/', import.meta.url));
  const endpoint = new URL(process.env.MCP_URL || `http://127.0.0.1:${settings.port}/mcp`);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) {
    throw new Error('远程 MCP_URL 必须使用 HTTPS。');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [index, [name, token]] of Object.entries(settings.tokens).entries()) {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const filename = `${index + 1}-${safeName}.json`;
    await writeFile(new URL(filename, new URL('../../.runtime/clients/', import.meta.url)), JSON.stringify({
      mcpServers: {
        'ima-knowledge': {
          type: 'http', url: endpoint.href,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }, null, 2) + '\n', { mode: 0o600 });
    console.log(`已生成 ${filename}；配置中包含该 Agent 的访问 token，请仅交给对应客户端。`);
  }
}
main().catch(() => { console.error('客户端配置生成失败，请检查服务配置。'); process.exitCode = 1; });
