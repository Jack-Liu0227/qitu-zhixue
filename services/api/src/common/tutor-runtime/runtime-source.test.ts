import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildTutorRuntimeBlocks, loadRuntimeSkillCatalog, loadTutorRuntimeSource } from './runtime-source';

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
  writeSkill(skillsRoot, 'teaching', '---\nruntime: teaching\nstatus: published\n---\n教学内容');
  writeSkill(skillsRoot, 'dev-tool', '---\nruntime: dev-only\n---\n开发工具说明');

  const source = loadTutorRuntimeSource();

  assert.deepEqual(source.skills.map((skill) => skill.id), ['teaching']);
  assert.equal(source.skills.some((skill) => skill.content.includes('开发工具说明')), false);
});

test('未登记的旧技能不得凭缺省元数据进入教学', () => {
  const { skillsRoot } = createProject();
  writeSkill(skillsRoot, 'legacy-teaching', '---\nname: 旧版教学技能\n---\n提问引导');

  const source = loadTutorRuntimeSource();

  assert.equal(source.skills.length, 0);
  assert.equal(loadRuntimeSkillCatalog().skills[0]?.status, 'unavailable');
});

test('统一目录展示 Admin 技能，但教学发现与提示构建均隔离 Admin 指令', () => {
  const { skillsRoot } = createProject();
  writeSkill(skillsRoot, 'teaching', '---\nruntime: teaching\nstatus: published\n---\n教学内容');
  writeSkill(skillsRoot, 'management', '---\nruntime: admin\nstatus: published\n---\nADMIN_ONLY_CONFIGURE');
  const catalog = loadRuntimeSkillCatalog();
  assert.equal(catalog.skills.length, 2);
  assert.equal(catalog.skills.find(skill => skill.id === 'management')?.runtime, 'admin');
  assert.deepEqual(loadTutorRuntimeSource().skills.map(skill => skill.id), ['teaching']);
  assert.doesNotMatch(buildTutorRuntimeBlocks(catalog).join('\n'), /ADMIN_ONLY_CONFIGURE/);
  assert.doesNotMatch(buildTutorRuntimeBlocks(catalog, ['management']).join('\n'), /ADMIN_ONLY_CONFIGURE/);
  assert.match(buildTutorRuntimeBlocks(catalog, ['teaching']).join('\n'), /教学内容/);
});

test('未知 runtime 留在管理目录报告不可用，不回退到教学范围', () => {
  const { skillsRoot } = createProject();
  writeSkill(skillsRoot, 'unknown-scope', '---\nruntime: misspelled-admin\n---\nPRIVATE_CONFIGURE');
  const catalog = loadRuntimeSkillCatalog();
  assert.equal(catalog.skills[0]?.status, 'unavailable');
  assert.equal(catalog.skills[0]?.runtime, 'unknown');
  assert.deepEqual(loadTutorRuntimeSource().skills, []);
  assert.doesNotMatch(buildTutorRuntimeBlocks(catalog).join('\n'), /PRIVATE_CONFIGURE/);
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
  writeSkill(skillsRoot, 'empty', '---\nruntime: teaching\nstatus: published\nname: 空技能\n---\n   ');

  const source = loadTutorRuntimeSource();

  assert.equal(source.skills[0]?.status, 'unavailable');
  assert.equal(source.skills[0]?.content, '');
});

test('缺失 SKILL.md 的技能仍出现在目录里，但不拖垮整个目录状态', () => {
  const { skillsRoot } = createProject();
  writeSkill(skillsRoot, 'healthy', '---\nruntime: teaching\nstatus: published\nname: healthy\n---\n教学内容');
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

test('long authorized skills and aggregate bundles are preserved without character ceilings', () => {
  const { skillsRoot } = createProject();
  for (const id of ['long-a', 'long-b']) {
    writeSkill(skillsRoot, id, `---\nruntime: teaching\nstatus: published\nname: ${id}\n---\n${'a'.repeat(300_000)}END_${id}`);
  }
  const source = loadTutorRuntimeSource();
  assert.ok(source.skills.every(skill => skill.status === 'ready' && skill.content.length > 300_000));
  const blocks = buildTutorRuntimeBlocks(source, ['long-a', 'long-b']).join('');
  assert.ok(blocks.length > 600_000);
  assert.ok(blocks.includes('END_long-a') && blocks.includes('END_long-b'));
});

test('revocation, drafts and malformed metadata never enter teaching prompts', () => {
  const { skillsRoot } = createProject();
  for (const status of ['revoked', 'reviewed', 'quarantined', 'deprecated', 'typo']) {
    writeSkill(skillsRoot, status, `---\nruntime: teaching\nstatus: ${status}\n---\nPRIVATE_${status}`);
  }
  writeSkill(skillsRoot, 'malformed', '---\nruntime: teaching\nstatus: published');
  writeSkill(skillsRoot, 'duplicate', '---\nruntime: admin\nruntime: teaching\nstatus: published\n---\nPRIVATE_DUPLICATE');
  const source = loadRuntimeSkillCatalog();
  assert.ok(source.skills.every(skill => skill.status === 'unavailable'));
  assert.doesNotMatch(buildTutorRuntimeBlocks(source, source.skills.map(skill => skill.id)).join(''), /PRIVATE_/);
});
