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
