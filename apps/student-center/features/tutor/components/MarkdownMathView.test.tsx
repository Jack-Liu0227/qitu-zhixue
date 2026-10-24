import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMathView } from './MarkdownMathView';

const render = (content: string) => renderToStaticMarkup(createElement(MarkdownMathView, { content }));

test('all four math delimiters and math inside emphasis render with KaTeX', () => {
  const html = render('$a^2$ \\(b^2\\)\n$$c^2$$\n\\[d^2\\]\n**$e^2$**');
  assert.equal((html.match(/class="katex"/g) ?? []).length, 5);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2);
  assert.match(html, /<strong[^>]*><span/);
});

test('CRLF and lone CR content render identically to LF across prose, math, and diagrams', () => {
  const content = '# Opening\nQuestion $a^2$\n- Evidence\n$$b^2$$\n```mermaid\nflowchart LR\n A --> B\n```\n```text\nsource\n```';
  const html = render(content);
  assert.equal(render(content.replace(/\n/g, '\r\n')), html);
  assert.equal(render(content.replace(/\n/g, '\r')), html);
  assert.doesNotMatch(html, /\r/);
});

test('code is literal, Mermaid fences are case insensitive, and prose HTML stays escaped', () => {
  const html = render('`$literal$`\n```js\nconst price = "$notMath$";\n```\n```Mermaid\nflowchart LR\n A --> B\n```\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /qitu-mermaid-loading/);
  assert.match(html, /const price/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
});

test('oversized formula fallback never injects HTML', () => {
  const html = render(`$$${'x'.repeat(4097)}<img src=x onerror=alert(1)>$$`);
  assert.match(html, /katex-fallback/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
});

test('untrusted KaTeX links cannot create active script URLs', () => {
  const html = render('$\\href{javascript:alert(1)}{click}$');
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<script/);
});

test('lesson test matrices render as readable tables with column headers and a bounded scroll region', () => {
  const html = render('测试记录\n| 操作 | 输入 | 预期 | 实际 |\n| --- | --- | --- | --- |\n| 命中 | 一颗子弹 | 加 10 分 | 加 10 分 |\n| 重开 | R | 生命恢复 | 生命 3 |\n\n接着解释结果。');
  assert.equal((html.match(/<table /g) ?? []).length, 1);
  assert.equal((html.match(/<th /g) ?? []).length, 4);
  assert.equal((html.match(/<td /g) ?? []).length, 8);
  assert.match(html, /scope="col"/);
  assert.match(html, /overflow-x:auto/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /\| ---/);
  assert.match(html, /接着解释结果/);
});

test('table cells preserve code, emphasis, inline math, escaped pipes, and declared alignment', () => {
  const html = render('内容 | 说明\n:--- | ---:\n**预测** | $x+1$\n`a\\|b` | 实际');
  assert.match(html, /<strong/);
  assert.match(html, /class="katex"/);
  assert.match(html, />a\|b<\/code>/);
  assert.match(html, /text-align:right/);
  assert.equal((html.match(/<td /g) ?? []).length, 4);
});

test('table HTML stays escaped and fenced table examples remain literal code', () => {
  const html = render('| 项目 | 内容 |\n| --- | --- |\n| 安全 | <img src=x onerror=alert(1)> |\n\n```text\n| a | b |\n| --- | --- |\n```');
  assert.equal((html.match(/<table /g) ?? []).length, 1);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /\| --- \| --- \|/);
});

test('ordinary pipes and malformed rows retain their visible text rather than disappearing into a table', () => {
  assert.doesNotMatch(render('a | b\nnot a separator'), /<table/);
  const html = render('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |');
  assert.match(html, /\| 1 \| 2 \| 3 \|/);
  assert.doesNotMatch(html, /<td /);
});
