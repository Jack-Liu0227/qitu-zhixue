import { loadConfig, type Config } from '../src/config.js';
import type { ImaApi, JsonObject } from '../src/ima.js';

export const tokens = { math: 'math-agent-'.padEnd(48, 'a'), planner: 'planner-agent-'.padEnd(48, 'b') };
export function config(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      IMA_OPENAPI_CLIENTID: 'test-client', IMA_OPENAPI_APIKEY: 'test-api-key',
      IMA_KNOWLEDGE_BASE_IDS: 'math,physics', MCP_CLIENT_TOKENS: JSON.stringify(tokens),
    }), ...overrides,
  };
}

export class MockIma implements ImaApi {
  calls: { path: string; body: JsonObject }[] = [];
  async call(path: string, body: JsonObject): Promise<JsonObject> {
    this.calls.push({ path, body });
    switch (path.split('/').at(-1)) {
      case 'get_knowledge_base': return { infos: { math: { id: 'math', name: '高中数学' }, physics: { id: 'physics', name: '高中物理' } } };
      case 'search_knowledge': return {
        info_list: [{ media_id: 'pdf-1', title: '数学教材.pdf', highlight_content: '定义：<em>对数</em>' }],
        is_end: true, next_cursor: '',
      };
      case 'get_knowledge_list': return {
        knowledge_list: body.folder_id
          ? [{ media_id: 'note-1', title: '课堂笔记' }]
          : [{ media_id: 'pdf-1', title: '数学教材.pdf' }, { folder_id: 'folder_chapter', name: '函数' }],
        is_end: false, next_cursor: 'next-page',
      };
      case 'get_media_info': return body.media_id === 'note-1'
        ? { media_type: 11, notebook_ext_info: { notebook_id: 'notebook-1' } }
        : { media_type: 1, url_info: { url: 'https://files.example.com/book.pdf', headers: { Authorization: 'Bearer source-only' } } };
      case 'get_doc_content': return { content: '课堂笔记：对数函数的底数须大于零且不等于一。'.repeat(20) };
      default: throw new Error('Unexpected mock endpoint: ' + path);
    }
  }
}

export function pdfFixture(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...['Hello IMA knowledge', 'Page two logarithm definition'].map(text => {
      const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, value] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${i + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}
