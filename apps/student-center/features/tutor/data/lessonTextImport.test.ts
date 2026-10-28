import assert from 'node:assert/strict';
import test from 'node:test';
import { importLessonTextFiles } from './lessonTextImport';

function file(name: string, content: string) {
  const bytes = new TextEncoder().encode(content);
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer };
}
test('multiple text files preserve their actual names/content without executing code', async () => {
  assert.equal(await importLessonTextFiles([file('记录.csv', 'a,b\n1,2'), file('main.py', 'print("hello")')], '我的结论'),
    '我的结论\n\n文件：记录.csv\na,b\n1,2\n\n文件：main.py\nprint("hello")');
});
test('unsupported, binary, oversized and invalid UTF-8 imports fail without partial truncation', async () => {
  for (const files of [[file('report.pdf', 'PDF')], [file('data.txt', '\0abc')], [file('large.md', 'a'.repeat(10001))],
    Array.from({ length: 6 }, () => file('small.txt', 'x'))]) await assert.rejects(importLessonTextFiles(files, '原文'));
  const invalid = { name: 'bad.txt', size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer };
  await assert.rejects(importLessonTextFiles([invalid], ''), /UTF-8/);
});
