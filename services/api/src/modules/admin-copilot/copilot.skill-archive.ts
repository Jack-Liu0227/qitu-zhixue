import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { AuditWriter } from '../../common/audit/audit.service';
import { loadRuntimeSkillCatalog } from '../../common/tutor-runtime/runtime-source';
import { exact, invalid, text } from './copilot.protocol';

/** Soft deletion keeps canonical identity and source text; it never removes a directory. */
export async function archiveTeachingSkill(actor: CurrentUser, input: Record<string, unknown>, key: string, audit: AuditWriter) {
  if (actor.role !== 'admin') throw new ForbiddenException('Admin required');
  exact(input, ['id', 'digest']);
  const id = text(input.id, 'id', 64); const digest = text(input.digest, 'digest', 64);
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || !/^[a-f0-9]{64}$/.test(digest) || !/^[a-zA-Z0-9_-]{1,160}$/.test(key)) invalid('Skill 删除参数无效');
  const root = await realpath(join(loadRuntimeSkillCatalog().root, '.agents', 'skills'));
  const directory = await realpath(join(root, id));
  if (relative(root, directory) !== id) invalid('Skill 路径越界');
  const path = join(directory, 'SKILL.md');
  if (await realpath(path) !== path || !(await stat(path)).isFile()) invalid('Skill 文件不可用');
  const lock = join(directory, '.publish-lock');
  const temporary = join(directory, `.archive-${key}`);
  const oldLock = await stat(lock).catch(() => null);
  if (oldLock && Date.now() - oldLock.mtimeMs > 180000) await unlink(lock);
  try { await writeFile(lock, key, { flag: 'wx' }); }
  catch { throw new ConflictException('Skill 正在修改，请重试'); }
  try {
    const raw = await readFile(path, 'utf8');
    const header = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!header || /^runtime:\s*admin\s*$/m.test(header[1]!)) invalid('不能删除管理技能或无效来源');
    if (/^status:\s*deprecated\s*$/m.test(header[1]!) && header[1]!.includes(`deleted-from: ${digest}`)) return id;
    const catalog = loadRuntimeSkillCatalog().skills.find(item => item.id === id);
    if ((catalog?.contentHash ?? createHash('sha256').update(raw).digest('hex')) !== digest) throw new ConflictException({ code: 'SKILL_DIGEST_CONFLICT', message: 'Skill 已变化，请回读当前摘要' });
    const managedDraft = /^managed-by:\s*admin-copilot\s*$/m.test(header[1]!) && /^runtime:\s*dev-only\s*$/m.test(header[1]!);
    if (catalog?.runtime !== 'teaching' && !managedDraft) invalid('仅可移除教学技能或管家草稿');
    const lines = header[1]!.split(/\r?\n/).filter(line => !/^(runtime|status|deleted-from):/.test(line));
    const next = `---\n${lines.join('\n')}\nruntime: teaching\nstatus: deprecated\ndeleted-from: ${digest}\n---\n${raw.slice(header[0].length)}`;
    await audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.copilot.skill.delete.requested',
      targetType: 'runtime_skill', targetId: id, idempotencyKey: `${key}:delete`, detail: { digest, deletionMode: 'soft' } });
    await writeFile(temporary, next, { flag: 'wx' });
    if (await realpath(path) !== path) invalid('Skill 路径已变化');
    await rename(temporary, path);
    const current = loadRuntimeSkillCatalog().skills.find(item => item.id === id);
    if (current?.publicationStatus !== 'deprecated' || current.status === 'ready') throw new ServiceUnavailableException('Skill 移除回读失败');
    return id;
  } finally {
    await unlink(temporary).catch(() => {});
    await unlink(lock).catch(() => {});
  }
}
