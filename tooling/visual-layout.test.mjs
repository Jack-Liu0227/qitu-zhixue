import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Render with dependencies declared by a consuming app, not incidental root hoists.
const require = createRequire(new URL('../apps/student-center/package.json', import.meta.url));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = readFileSync(new URL('../packages/ui/src/assistant.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
const artwork = { src: '/student/_next/static/media/qitu-companion.test.png' };
new Function('require', 'module', 'exports', compiled)(
  (id) => id.endsWith('.png') ? { default: artwork } : require(id),
  module,
  module.exports,
);
const { RobotMascot, AssistantGlyph } = module.exports;
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('companion uses the bundled basePath-aware asset at the requested size', () => {
  const html = render(RobotMascot, { size: 40 });
  assert.match(html, /src="\/student\/_next\/static\/media\/qitu-companion.test.png"/);
  assert.match(html, /width="40" height="40"/);
  assert.match(html, /alt="启途 AI 智学搭档"/);
});

test('decorative instances do not repeat adjacent assistant names to screen readers', () => {
  const html = render(RobotMascot, { decorative: true, mood: 'thinking' });
  assert.match(html, /alt=""/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /qitu-robot-thinking/);
});

test('legacy robot avatars and missing avatars use the same artwork', () => {
  for (const value of [undefined, null, '', '🤖', '🤖\uFE0F']) {
    assert.match(render(AssistantGlyph, { value }), /<img/);
  }
});

test('Admin-selected custom avatars stay unchanged', () => {
  assert.match(render(AssistantGlyph, { value: '🔬' }), /🔬/);
  assert.doesNotMatch(render(AssistantGlyph, { value: '🔬' }), /<img/);
});

test('runtime artwork is a small RGBA PNG, not a remote image', () => {
  const image = readFileSync(fileURLToPath(new URL('../packages/ui/assets/assistant/qitu-companion.png', import.meta.url)));
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.equal(image.readUInt32BE(16), 256);
  assert.equal(image.readUInt32BE(20), 256);
  assert.equal(image[25], 6);
  assert.ok(image.length < 120_000);
});
