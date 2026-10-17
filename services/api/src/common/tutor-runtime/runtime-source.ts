import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const POLICY_FILE = 'AGENTS.md';
const MAX_POLICY_CHARS = 12_000;
const MAX_SKILL_CHARS = 8_000;

export type TutorRuntimeSkillStatus = 'ready' | 'unavailable';
export type TutorRuntimeSkillsSourceStatus = 'ready' | 'missing' | 'unreadable';

export interface TutorRuntimeSkill {
  id: string;
  label: string;
  description: string | null;
  version: string | null;
  contentHash: string;
  status: TutorRuntimeSkillStatus;
  content: string;
}

export interface TutorRuntimePolicy {
  id: 'AGENTS.md';
  version: string;
  contentHash: string | null;
  status: 'ready' | 'missing';
  content: string;
}

export interface TutorRuntimeSkillsSource {
  root: string;
  status: TutorRuntimeSkillsSourceStatus;
  detail: string | null;
  /** 目录可读但个别技能包损坏（缺 SKILL.md / 不可读）。不影响 `status`。 */
  brokenPackages?: Array<{ id: string; detail: string }>;
}

export interface TutorRuntimeSource {
  root: string;
  policy: TutorRuntimePolicy;
  skills: TutorRuntimeSkill[];
  skillsSource?: TutorRuntimeSkillsSource;
}

export function loadTutorRuntimeSource(start = process.cwd()): TutorRuntimeSource {
  const root = findRuntimeRoot(start);
  const policyPath = join(root, POLICY_FILE);
  const policyRaw = readText(policyPath);
  const policyContent = trimForPrompt(policyRaw, MAX_POLICY_CHARS);
  const policyHash = policyRaw.length > 0 ? hash(policyRaw) : null;
  const policyVersion = readFrontmatter(policyRaw).version ?? (policyHash?.slice(0, 12) ?? 'unconfigured');

  const skillsDiscovery = discoverRuntimeSkills(join(root, '.agents', 'skills'));

  return {
    root,
    policy: {
      id: 'AGENTS.md',
      version: policyVersion,
      contentHash: policyHash,
      status: policyRaw.length > 0 ? 'ready' : 'missing',
      content: policyContent,
    },
    skills: skillsDiscovery.skills,
    skillsSource: skillsDiscovery.source,
  };
}

export function buildTutorRuntimeBlocks(
  source: TutorRuntimeSource,
  enabledSkillIds?: readonly string[],
): string[] {
  const blocks: string[] = [];
  if (source.policy.status === 'ready' && source.policy.content.length > 0) {
    blocks.push([
      `全局运行规则（${source.policy.id}，版本 ${source.policy.version}，只读策略）:`,
      source.policy.content,
    ].join('\n'));
  }

  const allowed = enabledSkillIds === undefined ? null : new Set(enabledSkillIds);
  for (const skill of source.skills) {
    if (skill.status !== 'ready' || (allowed !== null && !allowed.has(skill.id))) continue;
    blocks.push([
      `已发布教学 Skill（${skill.id}，版本 ${skill.version ?? 'unknown'}，只读能力说明）:`,
      skill.content,
    ].join('\n'));
  }
  return blocks;
}

function discoverRuntimeSkills(skillsRoot: string): {
  skills: TutorRuntimeSkill[];
  source: TutorRuntimeSkillsSource;
} {
  const brokenPackages: Array<{ id: string; detail: string }> = [];
  try {
    const entries = readdirSync(skillsRoot, { withFileTypes: true });
    const skills = entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const id = entry.name;
        let raw: string;
        try {
          raw = readFileSync(join(skillsRoot, id, 'SKILL.md'), 'utf8');
        } catch (error) {
          // 读不到 SKILL.md 不能让技能从目录里静默消失：管理面靠这份列表定位
          // 「哪个技能包坏了」，所以保留一条 unavailable 记录。
          // 但单个坏包**不得**把整个目录标成 unreadable：那会让一个无关技能
          // 把全局 initialization.overall 推到 degraded，掩盖真正的部署故障。
          brokenPackages.push({ id, detail: formatFsError(error) });
          return [{
            id,
            label: id,
            description: null,
            version: null,
            contentHash: hash(''),
            status: 'unavailable' as const,
            content: '',
          }];
        }

        const metadata = readFrontmatter(raw);
        // 只有显式标记的开发工具才排除，避免旧教学 skill 因缺字段而失效。
        if (metadata.runtime === 'dev-only') return [];

        const body = stripFrontmatter(raw);
        return [{
          id,
          label: metadata.name ?? id,
          description: metadata.description ?? null,
          version: metadata.version ?? null,
          contentHash: hash(raw),
          status: body.length > 0 ? 'ready' as const : 'unavailable' as const,
          content: trimForPrompt(body, MAX_SKILL_CHARS),
        }];
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      skills,
      source: {
        root: skillsRoot,
        // status 只反映**目录级**可读性；单个技能包的损坏由 skills[].status='unavailable'
        // 与 brokenPackages 表达，两者不得互相污染。
        status: 'ready',
        detail: null,
        brokenPackages,
      },
    };
  } catch (error) {
    const code = getFsErrorCode(error);
    return {
      skills: [],
      source: {
        root: skillsRoot,
        status: code === 'ENOENT' ? 'missing' : 'unreadable',
        detail: code === 'ENOENT' ? null : formatFsError(error),
      },
    };
  }
}

function getFsErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function formatFsError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // 文件系统错误通常会带路径；只清理常见凭据格式，避免诊断字段成为秘密泄漏通道。
  return message.replace(/((?:password|token|secret|api[_-]?key|authorization|bearer)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function findRuntimeRoot(start: string): string {
  const configured = process.env.QITU_PROJECT_ROOT?.trim();
  if (configured) return resolve(configured);

  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, POLICY_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function readFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && value) result[key] = value;
  }
  return result;
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
}

function trimForPrompt(value: string, limit: number): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}\n[内容已按运行时预算截断]`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
