import { credentials, loadEnvironment } from './config.js';
import { ImaClient, object, string } from './ima.js';

async function main() {
  loadEnvironment();
  const api = new ImaClient({ ...credentials(process.env), timeoutMs: 20000 });
  let cursor = '';
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const data = await api.call('openapi/wiki/v1/search_knowledge_base', { query: '', cursor, limit: 20 });
    if (!Array.isArray(data.info_list)) throw new Error('ima 未返回知识库列表。');
    for (const value of data.info_list) {
      const info = object(value);
      const id = string(info.id) || string(info.kb_id);
      const name = string(info.name) || string(info.kb_name);
      if (!id) throw new Error('ima 返回的知识库缺少 ID，请检查最新接口格式。');
      console.log(`${id}\t${name}`);
    }
    if (data.is_end === true) return;
    cursor = string(data.next_cursor);
    if (!cursor || seen.has(cursor)) throw new Error('ima 返回了无效的分页游标。');
    seen.add(cursor);
  }
  throw new Error('知识库数量超过查询上限，请调整查询工具。');
}
main().catch(error => { console.error(error instanceof Error ? error.message : '查询失败。'); process.exitCode = 1; });
