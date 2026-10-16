import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const story = JSON.parse(read('apps/auth-portal/app/home/storyboard.json'));

test('six accessible chapters match the composed 27-second film', () => {
  assert.equal(story.duration, 27);
  assert.equal(story.scenes.length, 6);
  assert.equal(new Set(story.scenes.map((scene) => scene.id)).size, 6);
  story.scenes.forEach((scene, index) => {
    assert.equal(scene.start, Number((4.4 * index).toFixed(1)));
    for (const field of ['label', 'title', 'description', 'alt']) assert.ok(scene[field].trim());
    const asset = new URL(`apps/auth-portal/public${scene.image}`, root);
    const bytes = readFileSync(asset);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(statSync(asset).size < 1200000, fileURLToPath(asset));
  });
  const video = readFileSync(new URL(`apps/auth-portal/public${story.video}`, root));
  assert.equal(video.toString('ascii', 4, 8), 'ftyp');
  assert.ok(video.length < 8000000, 'film must stay below the 8 MB transfer budget');
});

test('narrative retains explicit intent, theory gate and authorized evidence', () => {
  assert.match(story.scenes[1].description, /确认意图之后/);
  assert.match(story.scenes[2].description, /理论达标后/);
  assert.match(story.scenes[5].description, /授权范围/);
});

test('all five app roots import the shared brand layer after their base styles', () => {
  for (const app of ['auth-portal', 'student-center', 'parent-companion', 'teacher-workspace', 'admin-console']) {
    const layout = read(`apps/${app}/app/layout.tsx`);
    const cssImports = [...layout.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((match) => match[1]);
    assert.equal(cssImports.at(-1), '@qitu/ui/brand.css', app);
  }
});

test('shared brand preserves motion and mobile interaction floors', () => {
  const css = read('packages/ui/src/brand.css');
  assert.match(css, /html, body\s*\{\s*overflow-x:\s*clip/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /data-qitu-reduced-motion/);
  assert.match(css, /minmax\(0,/);
  assert.match(css, /focus-visible/);
});
