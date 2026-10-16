import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, loadEnvironment } from './config.js';
import { createHttpServer } from './http.js';
import { ImaClient } from './ima.js';
import { KnowledgeService } from './knowledge.js';
import { createMcpServer } from './mcp.js';

async function main() {
  loadEnvironment();
  const stdio = process.argv.includes('--stdio');
  const config = loadConfig(process.env, stdio);
  const knowledge = new KnowledgeService(config, new ImaClient(config));
  if (stdio) {
    const mcp = createMcpServer(knowledge);
    await mcp.connect(new StdioServerTransport());
    return;
  }
  const http = createHttpServer(config, knowledge);
  http.on('error', () => { console.error('MCP 监听失败，请检查端口或监听地址。'); process.exitCode = 1; });
  http.listen(config.port, config.host, () => {
    console.error(`ima MCP 已监听 ${config.host}:${config.port}/mcp，授权知识库 ${config.knowledgeBaseIds.length} 个。`);
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    http.close(() => { process.exitCode = 0; });
    const timer = setTimeout(() => process.exit(1), 30000);
    timer.unref();
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : '服务启动失败。');
  process.exitCode = 1;
});
