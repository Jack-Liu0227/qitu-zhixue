import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const story = JSON.parse(read('apps/auth-portal/app/home/storyboard.json'));

test('three student projects and nine accessible chapters match the composed 27-second film', () => {
  assert.equal(story.duration, 27);
  assert.equal(story.projects.length, 3);
  assert.deepEqual(story.projects.map((project) => project.id), ['drone', 'robot', 'optics']);
  assert.equal(story.scenes.length, 9);
  assert.equal(new Set(story.scenes.map((scene) => scene.id)).size, 9);
  story.scenes.forEach((scene, index) => {
    assert.equal(scene.start, index * 3);
    assert.ok(story.projects.some((project) => project.id === scene.project));
    for (const field of ['label', 'title', 'description', 'alt', 'project']) assert.ok(scene[field].trim());
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

test('narrative covers engineering, robotics and high-school optics', () => {
  assert.match(story.scenes[0].title, /无人机/);
  assert.match(story.scenes[3].title, /桌面机器人/);
  assert.match(story.scenes[6].title, /窄缝/);
  assert.match(story.scenes[7].description, /衍射/);
  assert.match(story.scenes[8].description, /散射/);
});

test('all five app roots import the shared brand layer after their base styles', () => {
  for (const app of ['auth-portal', 'student-center', 'parent-companion', 'teacher-workspace', 'admin-console']) {
    const layout = read(`apps/${app}/app/layout.tsx`);
    const cssImports = [...layout.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((match) => match[1]);
    const brandIndex = cssImports.indexOf('@qitu/ui/brand.css');
    assert.equal(cssImports.filter((path) => path === '@qitu/ui/brand.css').length, 1, app);
    for (const [index, path] of cssImports.entries()) {
      if (path === '@qitu/ui/brand.css' || path.endsWith('/ui-remediation.css')) continue;
      assert.ok(index < brandIndex, `${app}: ${path} must precede the shared brand layer`);
    }
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
