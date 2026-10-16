import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createDownloader, extractPdf, mediaHeaders, publicAddress, readSource, sourceUrl } from '../src/documents.js';
import { ImaClient, object, readLimited, ServiceError } from '../src/ima.js';
import { KnowledgeService } from '../src/knowledge.js';
import { References } from '../src/references.js';
import { config, MockIma, pdfFixture, tokens } from './fixtures.js';

test('配置必须包含凭证、知识库白名单和 HTTP token', () => {
  assert.throws(() => loadConfig({}), /CLIENTID/);
  const env = { IMA_CLIENT_ID: 'client', IMA_API_KEY: 'secret' };
  assert.throws(() => loadConfig(env), /KNOWLEDGE_BASE_IDS/);
  assert.throws(() => loadConfig({ ...env, IMA_KNOWLEDGE_BASE_IDS: 'math' }), /CLIENT_TOKENS/);
  assert.equal(loadConfig({ ...env, IMA_KNOWLEDGE_BASE_IDS: 'math' }, true).host, '127.0.0.1');
  assert.throws(() => loadConfig({ ...env, IMA_KNOWLEDGE_BASE_IDS: 'math', HOST: '0.0.0.0', MCP_CLIENT_TOKENS: JSON.stringify(tokens) }), /ALLOWED_HOSTS/);
});

test('官方 API 使用正确的认证头、POST、UTF-8 和参数', async () => {
  let seen = false;
  const client = new ImaClient(config(), async (url, init) => {
    assert.equal(url, 'https://ima.qq.com/openapi/wiki/v1/search_knowledge');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('ima-openapi-clientid'), 'test-client');
    assert.equal(headers.get('ima-openapi-apikey'), 'test-api-key');
    assert.equal(init?.method, 'POST');
    assert.equal(JSON.parse(String(init?.body)).query, '对数');
    assert.equal(init?.redirect, 'error');
    seen = true;
    return Response.json({ code: 0, data: { info_list: [] } });
  });
  await client.call('openapi/wiki/v1/search_knowledge', { query: '对数' });
  assert.ok(seen);
  await assert.rejects(() => client.call('openapi/wiki/v1/add_knowledge', {}), /只支持/);
});

test('API 错误和异常响应不会当成成功，错误消息去除凭证', async () => {
  const client = new ImaClient(config(), async () => Response.json({ code: 110030, msg: 'no permission test-api-key test-client' }));
  await assert.rejects(() => client.call('openapi/wiki/v1/get_media_info', {}), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, 'IMA_110030');
    assert.ok(!error.message.includes('test-api-key'));
    assert.ok(!error.message.includes('test-client'));
    return true;
  });
  for (const response of [Response.json({}), new Response('not json'), new Response('', { status: 429 })]) {
    await assert.rejects(() => new ImaClient(config(), async () => response).call('openapi/wiki/v1/get_media_info', {}));
  }
  await assert.rejects(() => new ImaClient(config(), async () => { throw new Error('secret network details'); }).call('openapi/wiki/v1/get_media_info', {}), /请求失败或超时/);
});

test('响应大小上限在 content-length 和流读取时都生效', async () => {
  await assert.rejects(() => readLimited(new Response('abc', { headers: { 'content-length': '1000' } }), 5), /大小上限/);
  await assert.rejects(() => readLimited(new Response('123456'), 5), /大小上限/);
});

test('知识库隔离、签名引用篡改及过期检查', () => {
  const refs = new References(['math']);
  const valid = refs.issue({ kb: 'math', id: 'doc-1', kind: 'document', title: '数学' });
  assert.equal(refs.read(valid, 'document').id, 'doc-1');
  assert.throws(() => refs.issue({ kb: 'secret', id: 'x', kind: 'document', title: '' }), /未获/);
  assert.throws(() => refs.read(valid + 'tamper', 'document'), /无效/);
  assert.throws(() => refs.read(valid, 'folder'), /无效/);
  assert.throws(() => new References(['math']).read(valid, 'document'), /无效/);
  const original = Date.now;
  try {
    Date.now = () => original() + 3600001;
    assert.throws(() => refs.read(valid, 'document'), /过期/);
  } finally { Date.now = original; }
});

test('多知识库服务只列授权库，保留关键词片段及游标', async () => {
  const api = new MockIma();
  const service = new KnowledgeService(config(), api);
  const bases = await service.listBases();
  assert.equal((bases.knowledge_bases as unknown[]).length, 2);
  const result = await service.search('math', '对数', 'cursor-2');
  const item = object((result.items as unknown[])[0]);
  assert.equal(item.excerpt, '定义：对数');
  assert.ok(item.document_ref);
  assert.equal(api.calls.at(-1)?.body.cursor, 'cursor-2');
  const before = api.calls.length;
  await assert.rejects(() => service.search('unapproved', 'x', ''), /未获/);
  await assert.rejects(() => service.read('raw-media-id', 1, 1, 1000, 0), /无效/);
  assert.equal(api.calls.length, before);
});

test('真实搜索响应省略分页字段时视为结束，避免重复请求第一页', async () => {
  const service = new KnowledgeService(config(), { call: async () => ({ info_list: [] }) });
  const response = await service.search('math', '对数', '');
  assert.equal(response.is_end, true);
  assert.equal(response.next_cursor, '');
});

test('子文件夹引用须属于指定知识库，笔记可分段读取', async () => {
  const api = new MockIma();
  const service = new KnowledgeService(config(), api);
  const root = await service.list('math', '', 20);
  const folder = object((root.items as unknown[])[1]);
  await assert.rejects(() => service.list('physics', '', 20, String(folder.folder_ref)), /不属于/);
  const nested = await service.list('math', '', 20, String(folder.folder_ref));
  assert.equal(api.calls.at(-1)?.body.folder_id, 'folder_chapter');
  const note = object((nested.items as unknown[])[0]);
  const read = await service.read(String(note.document_ref), 1, 1, 100, 100);
  assert.equal(read.available, true);
  assert.equal(read.offset, 100);
  assert.equal(String(read.content).length, 100);
  assert.equal(read.truncated, true);
  assert.equal(api.calls.at(-1)?.body.target_content_format, 0);
});

test('拒绝内网和非 HTTPS 原文地址，过滤 API 鉴权头', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '0.0.0.0', '224.0.0.1']) {
    assert.equal(publicAddress(address), false, address);
  }
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  for (const url of ['http://example.com/a', 'file:///etc/passwd', 'https://a:b@example.com/a', 'https://example.com:8000/a']) {
    assert.throws(() => sourceUrl(url));
  }
  assert.deepEqual(mediaHeaders({ Authorization: 'Bearer source', 'ima-openapi-apikey': 'secret', Host: 'private', 'X-Test': 'value', Cookie: 'bad\r\nvalue' }), {
    Authorization: 'Bearer source', 'X-Test': 'value',
  });
});

test('PDF 真正提取指定页面文字，引用使用 PDF 文件页序', async () => {
  const result = await extractPdf(pdfFixture(), 2, 1, 1000);
  assert.equal(result.total_pages, 2);
  const pages = result.pages as { page: number; text: string }[];
  assert.equal(pages.length, 1);
  assert.equal(pages[0]?.page, 2);
  assert.match(pages[0]!.text, /logarithm definition/);
  await assert.rejects(() => extractPdf(pdfFixture(), 3, 1, 1000), /共 2 页/);
});

test('真实下载器在建立连接前拒绝 localhost 和云元数据地址', async () => {
  const download = createDownloader(1024, 1000);
  await assert.rejects(() => download('https://127.0.0.1/private', {}), /非公网/);
  await assert.rejects(() => download('https://169.254.169.254/latest/meta-data', {}), /非公网/);
});

test('原文缺失、不可支持类型与文本截断不会伪造教材内容', async () => {
  const options = { startPage: 1, pageCount: 1, maxChars: 5, offset: 2 };
  const missing = await readSource({}, async () => { throw new Error('Must not download'); }, options);
  assert.equal(missing.available, false);
  const text = await readSource({ media_type: 13, url_info: { url: 'https://example.com/a.txt' } }, async () => ({ bytes: Buffer.from('0123456789'), contentType: 'text/plain' }), options);
  assert.equal(text.content, '23456');
  assert.equal(text.truncated, true);
  const unsupported = await readSource({ media_type: 4, url_info: { url: 'https://example.com/a.pptx' } }, async () => ({ bytes: Buffer.from('not-pdf'), contentType: 'application/octet-stream' }), options);
  assert.equal(unsupported.available, false);
});
