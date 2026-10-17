import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadTutorRuntimeSource } from './runtime-source';

const tempRoots: string[] = [];
const originalProjectRoot = process.env.QITU_PROJECT_ROOT;

function createProject(): { root: string; skillsRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'qitu-tutor-runtime-'));
  tempRoots.push(root);
  writeFileSync(join(root, 'AGENTS.md'), '---\nversion: test\n---\n策略');
  const skillsRoot = join(root, '.agents', 'skills');
  mkdirSync(skillsRoot, { recursive: true });
  process.env.QITU_PROJECT_ROOT = root;
  return { root, skillsRoot };
}

function writeSkill(skillsRoot: string, id: string, raw: string): void {
  const directory = join(skillsRoot, id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), raw);
}

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  if (originalProjectRoot === undefined) delete process.env.QITU_PROJECT_ROOT;
  else process.env.QITU_PROJECT_ROOT = originalProjectRoot;
});

test('runtime: dev-only 技能不会进入发现结果', () => {
  const { skillsRoot } = createProject();
  writeSkill(skillsRoot, 'teaching', '---\nruntime: teaching\n---\n教学内容');
  writeSkill(skillsRoot, 'dev-tool', '---\nruntime: dev-only\n---\n开发工具说明');

  const source = loadTutorRuntimeSource();

  assert.deepEqual(source.skills.map((skill) => skill.id), ['teaching']);
  assert.equal(source.skills.some((skill) => skill.content.includes('开发工具说明')), false);
});

test('runtime 缺省按 teaching 保留', () => {
  const { skillsRoot } = createProject();
  writeSkill(skillsRoot, 'legacy-teaching', '---\nname: 旧版教学技能\n---\n提问引导');

  const source = loadTutorRuntimeSource();

  assert.equal(source.skills.length, 1);
  assert.equal(source.skills[0]?.id, 'legacy-teaching');
  assert.equal(source.skills[0]?.status, 'ready');
});

test('技能目录不存在时返回 missing，不抛异常', () => {
  const { root } = createProject();
  rmSync(join(root, '.agents', 'skills'), { recursive: true, force: true });

  const source = loadTutorRuntimeSource();

  assert.deepEqual(source.skills, []);
  assert.equal(source.skillsSource?.status, 'missing');
  assert.equal(source.skillsSource?.detail, null);
});

test('正文为空时保留 unavailable 状态', () => {
  const { skillsRoot } = createProject();
  writeSkill(skillsRoot, 'empty', '---\nname: 空技能\n---\n   ');

  const source = loadTutorRuntimeSource();

  assert.equal(source.skills[0]?.status, 'unavailable');
  assert.equal(source.skills[0]?.content, '');
});

test('缺失 SKILL.md 的技能仍出现在目录里，但不拖垮整个目录状态', () => {
  const { skillsRoot } = createProject();
  writeSkill(skillsRoot, 'healthy', '---\nname: healthy\n---\n教学内容');
  // 只有目录、没有 SKILL.md：典型的坏技能包，不能从管理面静默消失。
  mkdirSync(join(skillsRoot, 'broken'), { recursive: true });

  const source = loadTutorRuntimeSource();
  const broken = source.skills.find((skill) => skill.id === 'broken');

  assert.equal(source.skills.some((skill) => skill.id === 'healthy'), true);
  assert.equal(broken?.status, 'unavailable');
  assert.equal(broken?.content, '');
  // 单个坏包只进 brokenPackages；目录级 status 仍为 ready，
  // 否则一个无关技能会把全局 initialization.overall 推到 degraded。
  assert.equal(source.skillsSource?.status, 'ready');
  assert.deepEqual(source.skillsSource?.brokenPackages?.map((entry) => entry.id), ['broken']);
});

test('超长正文按 8000 字符截断并附带标记', () => {
  const { skillsRoot } = createProject();
  writeSkill(skillsRoot, 'long', `---\nname: 长技能\n---\n${'甲'.repeat(8_500)}`);

  const source = loadTutorRuntimeSource();
  const content = source.skills[0]?.content ?? '';

  assert.equal(content.startsWith('甲'.repeat(8_000)), true);
  assert.equal(content.endsWith('[内容已按运行时预算截断]'), true);
  assert.equal(content.length, 8_000 + '\n[内容已按运行时预算截断]'.length);
});
