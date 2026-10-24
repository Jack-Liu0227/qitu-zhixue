import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkTextRenderer } from './WorkTextRenderer';

const render = (text: string) => renderToStaticMarkup(createElement(WorkTextRenderer, { text }));
const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function sources(html: string) {
  return [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map(match =>
    [...(match[1] ?? '').matchAll(/class="qitu-code-content">([\s\S]*?)<\/span>/g)]
      .map(cell => decode(cell[1] ?? '').replace(/[ \t]+$/, '')).join('\n').trimEnd());
}

test('published unfenced Python keeps trailing independent review outside the copyable source', () => {
  const source = 'import pygame\n\ndef main():\n    print("game")\n\nmain()';
  const html = render(source + '\n\n独立复核补充：另一 AI agent 完成自动化复核，不是真人试玩。');
  assert.deepEqual(sources(html), [source]);
  assert.match(html, /独立复核补充/);
  assert.match(html, /不是真人试玩/);
});

test('a source heading ends at following prose and does not consume later fenced examples', () => {
  const source = 'import pygame\nprint("ready")\npygame.quit()';
  const html = render('完整可运行源码：\n' + source + '\n\n测试说明：输入 R 后开始新一轮。\n\n```python\nprint("example")\n```');
  assert.deepEqual(sources(html), [source, 'print("example")']);
  assert.match(html, /测试说明/);
});

test('explicit fences after a source heading remain authoritative and exclude fence markers', () => {
  const source = 'text = "独立复核补充：游戏内说明"\nprint(text)';
  const html = render('完整源码 game.py:\n\n```python\n' + source + '\n```\n\n复核说明：运行正常。');
  assert.deepEqual(sources(html), [source]);
  assert.match(html, /复核说明/);
});

test('multiline strings, Chinese identifiers, comments, and escaped string quotes stay in implicit source', () => {
  const source = 'import pygame\n说明 = "游戏"\nmessage = """\n独立复核补充：这是游戏内字符串\n【游戏提示】\n"""\n# 运行说明：保留这条 Python 注释\nprint("a \\\" quote", 说明)';
  const html = render(source + '\n\n实际结果：窗口可正常关闭。');
  assert.deepEqual(sources(html), [source]);
  assert.match(html, /实际结果/);
});

test('fenced code remains literal and escaped even when it looks like a prose boundary', () => {
  const source = '# 独立复核补充：这是注释\nmessage = "<img src=x onerror=alert(1)>"';
  const html = render('```python\n' + source + '\n```\n解释：以上只作为字符串显示。');
  assert.deepEqual(sources(html), [source]);
  assert.doesNotMatch(html, /<img/);
});
