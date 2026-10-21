import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ADMIN_COPILOT_CONTRACT_VERSION, ADMIN_COPILOT_OPERATIONS, type AdminCopilotActionKind } from '@qitu/contracts';
import type { ModelRuntimeTool } from '@qitu/model-runtime';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRuntimeSkillCatalog } from '../../common/tutor-runtime/runtime-source';
import { MANAGEMENT_OPERATIONS_DIGEST, MANAGEMENT_SKILL_ID } from './copilot.resources';
import { exact, object, text } from './copilot.protocol';

interface ReferenceEntry {
  resource: string;
  description: string;
  operations: AdminCopilotActionKind[];
}
interface LoadedReference extends ReferenceEntry { digest: string; content: string }

function unavailable(): never {
  throw new ServiceUnavailableException({ code: 'COPILOT_REFERENCES_UNAVAILABLE',
    message: '管家模块参考缺失、越界或与能力目录不一致，请同步 Skill 资源包。' });
}

async function readBounded(path: string, maxBytes: number): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes || await realpath(path) !== path) unavailable();
  const value = await readFile(path, 'utf8');
  if (Buffer.byteLength(value, 'utf8') > maxBytes || await realpath(path) !== path) unavailable();
  return value;
}

/** Only the published Admin skill's declared text resources enter the model. No filesystem tool is exposed. */
export async function loadCopilotReferences(projectRoot = loadRuntimeSkillCatalog().root) {
  try {
    const expectedRoot = join(await realpath(projectRoot), '.agents', 'skills', MANAGEMENT_SKILL_ID);
    const root = await realpath(expectedRoot);
    if (root !== expectedRoot || (await lstat(root)).isSymbolicLink()) unavailable();
    const directory = join(root, 'references');
    if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) unavailable();
    const raw = await readBounded(join(directory, 'catalog.json'), 16000);
    const parsed: unknown = JSON.parse(raw);
    const manifest = object(parsed);
    exact(manifest, ['contractVersion', 'operationsDigest', 'resources']);
    if (manifest.contractVersion !== ADMIN_COPILOT_CONTRACT_VERSION || manifest.operationsDigest !== MANAGEMENT_OPERATIONS_DIGEST ||
        !Array.isArray(manifest.resources) || manifest.resources.length < 1 || manifest.resources.length > 12) unavailable();
    const covered = new Set<AdminCopilotActionKind>();
    const paths = new Set<string>();
    const resources: LoadedReference[] = [];
    let total = 0;
    for (const rawEntry of manifest.resources) {
      const entry = object(rawEntry);
      exact(entry, ['resource', 'description', 'operations']);
      const resource = text(entry.resource, 'resource');
      if (!/^references\/[a-z][a-z0-9-]*\.md$/.test(resource) || paths.has(resource) || !Array.isArray(entry.operations)) unavailable();
      paths.add(resource);
      const operations = entry.operations.map((kind: unknown) => {
        const operation = ADMIN_COPILOT_OPERATIONS.find(item => item.kind === kind);
        if (!operation || covered.has(operation.kind)) unavailable();
        covered.add(operation.kind);
        return operation.kind;
      });
      const content = await readBounded(join(root, ...resource.split('/')), 32768);
      if (!content.trim() || content.length > 8000) unavailable();
      total += content.length;
      if (total > 40000) unavailable();
      resources.push({ resource, description: text(entry.description, 'description', 300), operations, content,
        digest: createHash('sha256').update(content).digest('hex') });
    }
    if (covered.size !== ADMIN_COPILOT_OPERATIONS.length) unavailable();
    const digest = createHash('sha256').update(JSON.stringify({ manifest: parsed,
      files: resources.map(item => [item.resource, item.digest]) })).digest('hex');
    return { digest, resources };
  } catch { unavailable(); }
}

export type CopilotReferences = Awaited<ReturnType<typeof loadCopilotReferences>>;
export function referenceCatalog(bundle: CopilotReferences) {
  return { digest: bundle.digest, resources: bundle.resources.map(({ content: _content, ...entry }) => entry) };
}

export function createCopilotReferenceReader(bundle: CopilotReferences) {
  const read = new Set<string>();
  const tool: ModelRuntimeTool = {
    name: 'skill_read',
    description: 'Read the published Admin configurator module guides before proposing writes. Batch related resources in one call. Read-only; cannot call HTTP, run scripts or read other files.',
    inputSchema: { type: 'object', properties: {
      skill_id: { type: 'string', enum: [MANAGEMENT_SKILL_ID] },
      resources: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true,
        items: { type: 'string', enum: bundle.resources.map(item => item.resource) } },
    }, required: ['skill_id', 'resources'], additionalProperties: false },
    execute: async args => {
      exact(args, ['skill_id', 'resources']);
      if (args.skill_id !== MANAGEMENT_SKILL_ID || !Array.isArray(args.resources) || args.resources.length < 1 || args.resources.length > 12) {
        throw new BadRequestException({ code: 'COPILOT_REFERENCE_INVALID', message: '仅可读取当前管家目录中的模块手册。' });
      }
      const selected = args.resources.map((resource: unknown) => {
        const entry = bundle.resources.find(item => item.resource === resource);
        if (!entry) throw new BadRequestException({ code: 'COPILOT_REFERENCE_INVALID', message: '参考路径未登记。' });
        return entry;
      });
      const result = JSON.stringify({ skill_id: MANAGEMENT_SKILL_ID, bundleDigest: bundle.digest,
        resources: selected.map(({ resource, digest, content }) => ({ resource, digest, content })) });
      if (new Set(args.resources).size !== selected.length || result.length > 47000) {
        throw new BadRequestException({ code: 'COPILOT_REFERENCE_INVALID', message: '参考请求重复或超出读取预算。' });
      }
      selected.forEach(item => read.add(item.resource));
      return { text: result };
    },
  };
  return { tool, assertRead(kinds: readonly AdminCopilotActionKind[]) {
    const missing = bundle.resources.filter(entry => entry.operations.some(kind => kinds.includes(kind)) && !read.has(entry.resource));
    if (missing.length) throw new BadRequestException({ code: 'COPILOT_REFERENCE_REQUIRED',
      message: `生成配置计划前须读取对应模块手册：${missing.map(entry => entry.resource).join('、')}` });
  } };
}
