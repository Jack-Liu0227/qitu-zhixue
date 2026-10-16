import { loadEnvironment } from './config.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { object, string } from './ima.js';

async function main() {
  loadEnvironment();
  let tokens: Record<string, string> = {};
  if (process.env.MCP_CLIENT_TOKENS) tokens = JSON.parse(process.env.MCP_CLIENT_TOKENS);
  const token = process.env.MCP_SMOKE_TOKEN || Object.values(tokens)[0];
  if (!token) throw new Error('请配置 MCP_CLIENT_TOKENS 或 MCP_SMOKE_TOKEN。');
  const endpoint = new URL(process.env.MCP_URL || `http://127.0.0.1:${process.env.PORT || 8787}/mcp`);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) {
    throw new Error('远程 MCP_URL 必须使用 HTTPS。');
  }
  const client = new Client({ name: 'ima-smoke', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const tools = await client.listTools();
    console.log(`MCP 已连接，工具数量：${tools.tools.length}`);
    const bases = await client.callTool({ name: 'ima_list_knowledge_bases', arguments: {} });
    if (bases.isError) throw new Error('知识库查询失败，请检查 ima 凭证和知识库授权。');
    const data = object(bases.structuredContent);
    const first = Array.isArray(data.knowledge_bases) ? object(data.knowledge_bases[0]) : {};
    const kb = string(first.knowledge_base_id);
    if (!kb) throw new Error('未返回授权知识库。');
    console.log(`授权知识库已读取：${string(first.name) || kb}`);
    const search = await client.callTool({ name: 'ima_search_knowledge', arguments: { knowledge_base_id: kb, query: process.env.IMA_SMOKE_QUERY || '对数' } });
    if (search.isError) throw new Error('知识库搜索失败。');
    const results = object(search.structuredContent);
    const items = Array.isArray(results.items) ? results.items.map(object) : [];
    console.log(`搜索已完成，本页结果：${items.length} 条`);
    const document = items.find(item => item.kind === 'document');
    if (!document) throw new Error('本次搜索没有文档结果，请换一个教材关键词后重试；尚未验证原文读取。');
    const read = await client.callTool({ name: 'ima_read_document', arguments: { document_ref: document.document_ref, start_page: 1, page_count: 1 } });
    if (read.isError || object(read.structuredContent).available !== true) throw new Error('原文读取未成功，请检查原文可访问性和文件格式。');
    const content = object(read.structuredContent);
    const hasText = content.format === 'pdf_text'
      ? Array.isArray(content.pages) && content.pages.some(page => string(object(page).text).trim())
      : string(content.content).trim();
    if (!hasText) throw new Error('原文已获取，但没有提取到文字，可能需要 OCR；尚未验证可用的教材正文。');
    console.log('真实 ima 搜索及原文文字读取成功。请另外核对公式提取与回答质量。');
  } finally { await client.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : '验证失败。'); process.exitCode = 1; });
