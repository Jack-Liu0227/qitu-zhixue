import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const POLICY_FILE = 'AGENTS.md';
const MAX_POLICY_CHARS = 12_000;
const MAX_SKILL_CHARS = 8_000;

export type TutorRuntimeSkillStatus = 'ready' | 'unavailable';

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

export interface TutorRuntimeSource {
  root: string;
  policy: TutorRuntimePolicy;
  skills: TutorRuntimeSkill[];
}

export function loadTutorRuntimeSource(start = process.cwd()): TutorRuntimeSource {
  const root = findRuntimeRoot(start);
  const policyPath = join(root, POLICY_FILE);
  const policyRaw = readText(policyPath);
  const policyContent = trimForPrompt(policyRaw, MAX_POLICY_CHARS);
  const policyHash = policyRaw.length > 0 ? hash(policyRaw) : null;
  const policyVersion = readFrontmatter(policyRaw).version ?? (policyHash?.slice(0, 12) ?? 'unconfigured');

  return {
    root,
    policy: {
      id: 'AGENTS.md',
      version: policyVersion,
      contentHash: policyHash,
      status: policyRaw.length > 0 ? 'ready' : 'missing',
      content: policyContent,
    },
    skills: discoverRuntimeSkills(join(root, '.agents', 'skills')),
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

function discoverRuntimeSkills(skillsRoot: string): TutorRuntimeSkill[] {
  if (!existsSync(skillsRoot)) return [];
  try {
    return readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const id = entry.name;
        const raw = readText(join(skillsRoot, id, 'SKILL.md'));
        const metadata = readFrontmatter(raw);
        const body = stripFrontmatter(raw);
        return {
          id,
          label: metadata.name ?? id,
          description: metadata.description ?? null,
          version: metadata.version ?? null,
          contentHash: hash(raw),
          status: body.length > 0 ? 'ready' as const : 'unavailable' as const,
          content: trimForPrompt(body, MAX_SKILL_CHARS),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
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
