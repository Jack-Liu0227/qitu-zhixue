import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Render with dependencies declared by a consuming app, not incidental root hoists.
const require = createRequire(new URL('../apps/student-center/package.json', import.meta.url));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const modules = new Map();
function loadSource(file) {
  if (modules.has(file.href)) return modules.get(file.href).exports;
  const module = { exports: {} };
  modules.set(file.href, module);
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)((id) => {
    if (id.endsWith('.png')) return { default: { src: `/student/_next/static/media/${id.endsWith('/qitu-companion.png') ? 'qitu-companion.test.png' : id.split('/').at(-1)}` } };
    if (id === '@qitu/contracts') return loadSource(new URL('../packages/contracts/src/visual-assets.ts', import.meta.url));
    if (id === '@qitu/design-tokens') return loadSource(new URL('../packages/design-tokens/src/index.ts', import.meta.url));
    if (!id.startsWith('.')) return require(id);
    const target = ['.ts', '.tsx'].map((ext) => new URL(id + ext, file)).find((url) => existsSync(url));
    assert.ok(target, `Missing source dependency ${id}`);
    return loadSource(target);
  }, module, module.exports);
  return module.exports;
}
const { RobotMascot, AssistantGlyph } = loadSource(new URL('../packages/ui/src/assistant.tsx', import.meta.url));
const { NavigationArtwork } = loadSource(new URL('../packages/ui/src/navigation-artwork.tsx', import.meta.url));
const { BrandMark, BrandLogo } = loadSource(new URL('../packages/ui/src/brand.tsx', import.meta.url));
const { NAVIGATION_ARTWORK, getNavigationArtwork } = loadSource(new URL('../packages/ui/src/navigation-artwork.catalog.ts', import.meta.url));
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('companion uses the bundled basePath-aware asset at the requested size', () => {
  const html = render(RobotMascot, { size: 40 });
  assert.match(html, /src="\/student\/_next\/static\/media\/avatar-general-v1-64.png"/);
  assert.match(html, /width="40" height="40"/);
  assert.match(html, /alt="启途 AI 智学搭档"/);
});

test('decorative instances do not repeat adjacent assistant names to screen readers', () => {
  const html = render(RobotMascot, { decorative: true, mood: 'thinking' });
  assert.match(html, /alt=""/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /emotion-thinking-v1-\d+\.png/);
});

test('legacy robot avatars and missing avatars use the same artwork', () => {
  for (const value of [undefined, null, '', '🤖', '🤖\uFE0F']) {
    assert.match(render(AssistantGlyph, { value }), /<img/);
  }
});

test('library selections survive; old emoji and URLs use the shared default', () => {
  assert.match(render(AssistantGlyph, { value: 'asset:avatar-data-v1' }), /avatar-data-v1/);
  for (const value of ['🔬', 'https://example.test/old.png']) {
    const html = render(AssistantGlyph, { value });
    assert.match(html, /avatar-general-v1/);
    assert.doesNotMatch(html, /example\.test|🔬/);
  }
});

test('runtime artwork is a small RGBA PNG, not a remote image', () => {
  const image = readFileSync(fileURLToPath(new URL('../packages/ui/assets/brand/qitu-sidebar-companion-v2.png', import.meta.url)));
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.equal(image.readUInt32BE(16), 256);
  assert.equal(image.readUInt32BE(20), 256);
  assert.ok(image[25] === 6 || (image[25] === 3 && image.includes(Buffer.from('tRNS'))));
  assert.ok(image.length < 120_000);
});

function declaredRoutes(path, variable) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes = [];
  let found = false;
  function collect(node) {
    if (ts.isPropertyAssignment(node) && ['path', 'href'].includes(node.name.getText(source)) && ts.isStringLiteral(node.initializer)) {
      routes.push(node.initializer.text);
    }
    ts.forEachChild(node, collect);
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === variable && node.initializer) {
      found = true;
      collect(node.initializer);
    } else ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Missing real navigation declaration: ${path} ${variable}`);
  return routes;
}

test('every real sidebar and Admin settings entry has a registered artwork', () => {
  const inputs = [
    ...declaredRoutes('../apps/student-center/app/student-shell.tsx', 'NAV_SPECS').map(path => `/student${path}`),
    ...declaredRoutes('../apps/parent-companion/features/ParentShell.tsx', 'specs').map(path => path === '/' ? '/parent' : `/parent${path}`),
    ...declaredRoutes('../apps/teacher-workspace/components/teacher-shell.tsx', 'NAV_ITEMS'),
    ...declaredRoutes('../apps/admin-console/app/(console)/layout.tsx', 'NAV_SPECS').map(path => path === '/' ? '/admin' : `/admin${path}`),
    ...declaredRoutes('../services/api/src/modules/settings/settings-registry.service.ts', 'REGISTRY'),
  ];
  const fallback = declaredRoutes('../apps/admin-console/app/(console)/settings/layout.tsx', 'FALLBACK_SETTINGS_NAV');
  for (const path of [...inputs, ...fallback]) assert.ok(getNavigationArtwork(path), `Unmapped sidebar: ${path}`);
  assert.deepEqual(new Set(inputs), new Set(Object.keys(NAVIGATION_ARTWORK)));
});

test('all navigation destinations render distinct image files and distinct image bytes', () => {
  const assetsRoot = fileURLToPath(new URL('../packages/ui/assets/', import.meta.url));
  const files = readdirSync(assetsRoot, { recursive: true }).filter(path => path.endsWith('.png'));
  const hashes = new Map();
  const sources = new Set();
  for (const href of Object.keys(NAVIGATION_ARTWORK)) {
    const html = render(NavigationArtwork, { href });
    const src = html.match(/src="([^"]+)"/)?.[1];
    assert.ok(src, `Missing sidebar image: ${href}`);
    assert.equal(sources.has(src), false, `Repeated image URL: ${href}`);
    sources.add(src);
    const matches = files.filter(path => basename(path) === src.split('/').at(-1));
    assert.equal(matches.length, 1, `Missing or ambiguous bundled image: ${href}`);
    const digest = createHash('sha256').update(readFileSync(join(assetsRoot, matches[0]))).digest('hex');
    assert.equal(hashes.has(digest), false, `Same pixels for ${href} and ${hashes.get(digest)}`);
    hashes.set(digest, href);
    assert.match(html, /alt=""/);
    assert.match(html, /aria-hidden="true"/);
  }
});

test('platform roots stay distinct while basePath aliases and query strings resolve consistently', () => {
  assert.notDeepEqual(getNavigationArtwork('/parent'), getNavigationArtwork('/admin'));
  assert.notDeepEqual(getNavigationArtwork('/admin/settings'), getNavigationArtwork('/settings'));
  assert.deepEqual(getNavigationArtwork('/teacher/students/'), getNavigationArtwork('/students'));
  assert.deepEqual(getNavigationArtwork('/admin/settings/database?tab=schema'), getNavigationArtwork('/settings/database'));
  assert.deepEqual(getNavigationArtwork('/student/today#tasks'), getNavigationArtwork('/today'));
});

test('brand positions preserve the supplied logo and navigation never uses it as a feature icon', () => {
  assert.match(render(BrandMark, { size: 40 }), /\/mark\.png/);
  assert.match(render(BrandLogo, {}), /\/full\.png/);
  assert.deepEqual(readFileSync(new URL('../packages/ui/assets/logo/source.png', import.meta.url)),
    readFileSync(new URL('../docs/logo.png', import.meta.url)));
  for (const href of Object.keys(NAVIGATION_ARTWORK)) {
    assert.doesNotMatch(render(NavigationArtwork, { href }), /\/(mark|full|source)\.png|qitu-sidebar-companion/);
  }
});

function readView(path) {
  return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function renderAssistantAvatarSlot(className, value) {
  const source = readView('../apps/admin-console/app/(console)/settings/assistants/page.tsx');
  let slot;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr =>
      ts.isJsxAttribute(attr) && attr.name.getText(source) === 'className' && attr.initializer &&
      ts.isStringLiteral(attr.initializer) && attr.initializer.text === className)) slot = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(slot, `Missing actual assistant avatar slot: ${className}`);
  const compiled = ts.transpileModule(`export const AvatarSlot = () => (${slot.getText(source)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'AssistantGlyph', 'item', 'editingAssistant', compiled)(
    require, module, module.exports, AssistantGlyph, { icon: value }, { icon: value });
  return render(module.exports.AvatarSlot, {});
}

for (const slot of ['admin-card-icon-box', 'admin-identity-avatar-icon']) {
  test(`saved material avatars render as images in the real ${slot} view`, () => {
    for (const value of ['asset:avatar-general-v1', 'asset:avatar-data-v1', '🤖', null, undefined, 'asset:missing-avatar']) {
      const html = renderAssistantAvatarSlot(slot, value);
      assert.match(html, /<img/);
      assert.match(html, value === 'asset:avatar-data-v1' ? /avatar-data-v1/ : /avatar-general-v1/);
      assert.doesNotMatch(html, /asset:/);
    }
  });
}

test('Admin views never render stored assistant avatar strings directly as JSX text', () => {
  const views = ['app/(console)/copilot/page.tsx', 'app/(console)/settings/assistants/page.tsx',
    'app/(console)/settings/page.tsx', 'app/(console)/settings/skills/page.tsx',
    'app/(console)/settings/teams/components/TeamDetailView.tsx',
    'lib/components/knowledge-library/CreateLibraryModal.tsx',
    'lib/components/knowledge-library/LibraryAssistantBindings.tsx',
    'lib/components/knowledge-library/LibraryDetail.tsx'];
  const iconOwners = new Set(['item', 'editingAssistant', 'activeTestAssistant']);
  function isStoredAvatar(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text === 'avatar' ||
      (node.name.text === 'icon' && ts.isIdentifier(node.expression) && iconOwners.has(node.expression.text));
    if (ts.isParenthesizedExpression(node)) return isStoredAvatar(node.expression);
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      return isStoredAvatar(node.left) || isStoredAvatar(node.right);
    }
    if (ts.isConditionalExpression(node)) return isStoredAvatar(node.whenTrue) || isStoredAvatar(node.whenFalse);
    return false;
  }
  const rawSlots = [];
  for (const view of views) {
    const source = readView(`../apps/admin-console/${view}`);
    function visit(node) {
      if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && isStoredAvatar(node.expression)) {
        rawSlots.push(`${view}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(rawSlots, [], `Raw avatar text in Admin views: ${rawSlots.join(', ')}`);
});
