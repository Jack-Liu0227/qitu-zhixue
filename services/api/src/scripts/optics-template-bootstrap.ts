import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { CurrentUser, TeachingBundleDraft } from '@qitu/contracts';
import { readFileSync } from 'node:fs';
import { parseTeachingBundleDraft } from '../modules/templates/templates-binding.controller';
import { AuditModule } from '../common/audit/audit.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { hashRequest } from '../common/idempotency/idempotency.hash';
import { DatabaseModule } from '../database';
import { TemplateBindingService } from '../modules/templates/templates-binding.service';
import { TemplateBindingStore } from '../modules/templates/templates-binding.store';
import { TemplateGovernanceService } from '../modules/templates/templates-governance.service';
import { TemplateStore } from '../modules/templates/templates.store';
import { TemplatesModule } from '../modules/templates/templates.module';
import {
  OPTICS_16_QUALITY_TEMPLATE_SLUG, OPTICS_16_QUALITY_BOOTSTRAP_KEY,
  OPTICS_16_QUALITY_TEMPLATE_INPUT, OPTICS_16_QUALITY_VERSION_INPUT,
  assertOpticsTemplateStructure,
  OPTICS_16_COMPLETION_BOOTSTRAP_KEY,
  OPTICS_16_COMPLETION_TEMPLATE_SLUG,
  OPTICS_16_COMPLETION_TEMPLATE_INPUT,
  OPTICS_16_COMPLETION_VERSION_INPUT,
} from '../modules/templates/content/optics';
import { assertTemplateTeachingContent } from '../modules/templates/templates.content-validator';
import type {
  ProjectTemplateRecord,
  ProjectTemplateVersionRecord,
} from '../modules/templates/templates.types';

/**
 * 光学 PBL 模板引导脚本（server 端 CLI，编译后执行）：
 *
 *   pnpm --filter @qitu/api build
 *   node services/api/dist/scripts/optics-template-bootstrap.js --team-version-id <id>
 *
 * 全程只走治理服务（audited / idempotent / ordered），**不写 seed SQL**：
 *   resolve-or-create 模板 → resolve-or-create 版本 → 结构校验 → pilot →
 *   binding create → validate → activate。
 *
 * 幂等：跨进程重跑不产生第二个版本（按 `content.bootstrapKey` 解析）或第二个
 * 绑定（先查 active，再 `listBindings` 去重）。
 *
 * 发布 / 验证**永远拒绝**：脚本不调用 `publishVersion` / `verifyVersion`，
 * 由操作员按 `docs/pedagogy/optics-pbl.md` 跑完整证据门。
 */

const RUNBOOK_POINTER = '见 docs/pedagogy/optics-pbl.md「发布与验证」章节';

export class OpticsBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpticsBootstrapError';
  }
}

export interface OpticsBootstrapDeps {
  governance: TemplateGovernanceService;
  bindings: TemplateBindingService;
  templates: TemplateStore;
  bindingStore: TemplateBindingStore;
}

export interface OpticsBootstrapArgs {
  qualityReview?: boolean;
  teamVersionId: string;
  actor: CurrentUser;
  pilotReason: string;
  teachingBundle?: Omit<TeachingBundleDraft, 'templateVersionId' | 'teamVersionId'>;
}

export interface OpticsBootstrapStep {
  step: string;
  action: 'create' | 'reuse' | 'noop' | 'transition';
  detail: string;
}

export interface OpticsBootstrapReport {
  templateId: string;
  versionId: string;
  bindingId: string | null;
  steps: OpticsBootstrapStep[];
  refusedActions: readonly string[];
}

/** 结构化校验通过后执行完整引导；任何治理拒绝都 throw（fail loudly）。 */
export async function runOpticsTemplateBootstrap(
  deps: OpticsBootstrapDeps,
  args: OpticsBootstrapArgs,
): Promise<OpticsBootstrapReport> {
  const slug = args.qualityReview ? OPTICS_16_QUALITY_TEMPLATE_SLUG : OPTICS_16_COMPLETION_TEMPLATE_SLUG;
  const templateInput = args.qualityReview ? OPTICS_16_QUALITY_TEMPLATE_INPUT : OPTICS_16_COMPLETION_TEMPLATE_INPUT;
  const versionInput = args.qualityReview ? OPTICS_16_QUALITY_VERSION_INPUT : OPTICS_16_COMPLETION_VERSION_INPUT;
  const bootstrapKey = args.qualityReview ? OPTICS_16_QUALITY_BOOTSTRAP_KEY : OPTICS_16_COMPLETION_BOOTSTRAP_KEY;
  const keyPrefix = args.qualityReview ? 'optics16-quality-bootstrap' : 'optics16-completion-bootstrap';
  assertOpticsTemplateStructure();
  assertTemplateTeachingContent(versionInput.content ?? {}, versionInput.stages);

  const steps: OpticsBootstrapStep[] = [];

  // 0. 团队版本必须已存在；否则 fail loudly（不创建团队快照）。
  const teamVersion = await deps.bindingStore.findTeamVersion(args.teamVersionId);
  if (teamVersion === null) {
    throw new OpticsBootstrapError(`团队版本不存在：${args.teamVersionId}`);
  }

  // 1. resolve-or-create 模板（按 slug 去重）。
  let template = await deps.templates.findTemplateBySlug(null, slug);
  if (template === null) {
    const created = await deps.governance.createTemplate(
      args.actor,
      templateInput,
      `${keyPrefix}:template`,
    );
    const record = await deps.templates.findTemplate(created.template.id);
    if (record === null)
      throw new OpticsBootstrapError(`创建模板后无法读取：${created.template.id}`);
    template = record;
    steps.push({
      step: 'template',
      action: 'create',
      detail: `id=${template.id} slug=${template.slug}`,
    });
  } else {
    steps.push({
      step: 'template',
      action: 'reuse',
      detail: `id=${template.id} slug=${template.slug}`,
    });
  }

  // 2. resolve-or-create 版本（按 content.bootstrapKey 去重，跨进程稳定）。
  let version = await resolveBootstrapVersion(deps, template, bootstrapKey);
  if (version === null) {
    const created = await deps.governance.createVersion(
      args.actor,
      template.id,
      versionInput,
      `${keyPrefix}:version`,
    );
    const record = await deps.templates.findVersion(created.version.id);
    if (record === null)
      throw new OpticsBootstrapError(`创建版本后无法读取：${created.version.id}`);
    version = record;
    steps.push({
      step: 'version',
      action: 'create',
      detail: `id=${version.id} version=${version.version}`,
    });
  } else {
    steps.push({
      step: 'version',
      action: 'reuse',
      detail: `id=${version.id} version=${version.version} status=${version.status}`,
    });
  }

  // 3. pilot：draft → piloting；已是 piloting/published 视为幂等 no-op；其余 fail loudly。
  if (hashRequest({ stages: version.stages, content: version.content, rubric: version.rubric })
    !== hashRequest({ stages: versionInput.stages, content: versionInput.content ?? {}, rubric: versionInput.rubric ?? [] })) {
    throw new OpticsBootstrapError('16-session bootstrap identity has different content; create a new reviewed template version instead of overwriting or reusing it.');
  }

  const pilotKey = `${keyPrefix}:pilot`;
  if (version.status === 'draft') {
    await deps.governance.pilotVersion(
      args.actor,
      template.id,
      version.id,
      pilotKey,
      args.pilotReason,
    );
    const piloted = await deps.templates.findVersion(version.id);
    if (piloted === null) throw new OpticsBootstrapError(`试点后无法读取版本：${version.id}`);
    version = piloted;
    steps.push({
      step: 'pilot',
      action: 'transition',
      detail: `version=${version.id} status=${version.status}`,
    });
  } else if (version.status === 'piloting' || version.status === 'published') {
    steps.push({
      step: 'pilot',
      action: 'noop',
      detail: `version=${version.id} already ${version.status}`,
    });
  } else {
    throw new OpticsBootstrapError(
      `模板版本 ${version.id} 状态为 ${version.status}，无法进入试点；请按 runbook 处理（${RUNBOOK_POINTER}）`,
    );
  }

  // 4. binding：create（若需要）→ validate → activate。
  const bindingId = await ensureActiveBinding(deps, args, template, version, steps);

  return {
    templateId: template.id,
    versionId: version.id,
    bindingId,
    steps,
    refusedActions: ['template.version.verify', 'template.version.publish'],
  };
}

async function resolveBootstrapVersion(
  deps: OpticsBootstrapDeps,
  template: ProjectTemplateRecord,
  bootstrapKey: string,
): Promise<ProjectTemplateVersionRecord | null> {
  const versions = await deps.templates.listVersions(template.id);
  for (const version of versions) {
    const content = version.content as { bootstrapKey?: unknown } | undefined;
    if (
      content !== null &&
      typeof content === 'object' &&
      content.bootstrapKey === bootstrapKey
    ) {
      return version;
    }
  }
  return null;
}

async function ensureActiveBinding(
  deps: OpticsBootstrapDeps,
  args: OpticsBootstrapArgs,
  template: ProjectTemplateRecord,
  version: ProjectTemplateVersionRecord,
  steps: OpticsBootstrapStep[],
): Promise<string> {
  const keyPrefix = 'optics16-completion-bootstrap';
  const active = await deps.bindingStore.findActiveBinding(version.id);
  if (active !== null) {
    if (active.teamVersionId === args.teamVersionId) {
      steps.push({
        step: 'binding',
        action: 'noop',
        detail: `id=${active.id} already active for team=${active.teamVersionId}`,
      });
      return active.id;
    }
    throw new OpticsBootstrapError(
      `模板版本 ${version.id} 已存在指向另一团队版本的 active 绑定 ${active.id}；请先经治理 API 退役后再重跑（${RUNBOOK_POINTER}）`,
    );
  }

  const existing = await deps.bindingStore.listBindings(version.id);
  const target = existing.find((binding) => binding.teamVersionId === args.teamVersionId) ?? null;

  let bindingId: string;
  if (target === null) {
    const created = await deps.bindings.createBinding(
      args.actor,
      template.id,
      version.id,
      { teamVersionId: args.teamVersionId },
      `${keyPrefix}:binding`,
    );
    bindingId = created.binding.id;
    steps.push({
      step: 'binding',
      action: 'create',
      detail: `id=${bindingId} team=${args.teamVersionId}`,
    });
  } else {
    bindingId = target.id;
    steps.push({
      step: 'binding',
      action: 'reuse',
      detail: `id=${bindingId} team=${args.teamVersionId} status=${target.status}`,
    });
  }

  const current = await deps.bindingStore.findBinding(bindingId);
  if (current === null) throw new OpticsBootstrapError(`绑定不存在：${bindingId}`);

  if (current.status === 'draft') {
    if (!current.bundleDraft && args.teachingBundle) {
      const draft = parseTeachingBundleDraft({
        ...args.teachingBundle, templateVersionId: version.id, teamVersionId: args.teamVersionId,
      });
      await deps.bindings.saveTeachingBundleDraft(
        args.actor, template.id, version.id, bindingId, draft, `${keyPrefix}:bundle:${bindingId}`,
      );
    }
    await deps.bindings.validateBinding(
      args.actor,
      template.id,
      version.id,
      bindingId,
      `${keyPrefix}:validate:${bindingId}`,
    );
    steps.push({
      step: 'binding',
      action: 'transition',
      detail: `id=${bindingId} draft → validated`,
    });
  } else if (current.status === 'validated') {
    steps.push({ step: 'binding', action: 'noop', detail: `id=${bindingId} already validated` });
  } else if (current.status === 'active') {
    steps.push({ step: 'binding', action: 'noop', detail: `id=${bindingId} already active` });
    return bindingId;
  } else {
    throw new OpticsBootstrapError(
      `绑定 ${bindingId} 状态为 ${current.status}（retired），不自动复活；请按 runbook 处理（${RUNBOOK_POINTER}）`,
    );
  }

  await deps.bindings.activateBinding(
    args.actor,
    template.id,
    version.id,
    bindingId,
    `${keyPrefix}:activate:${bindingId}`,
  );
  steps.push({
    step: 'binding',
    action: 'transition',
    detail: `id=${bindingId} validated → active`,
  });
  return bindingId;
}

/* ============================ CLI ============================ */

interface CliArgs {
  qualityReview: boolean;
  teamVersionId: string | null;
  adminUserId: string | null;
  pilotReason: string;
  refused: string[];
  teachingBundleFile: string | null;
}

function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    qualityReview: false,
    teamVersionId: null,
    adminUserId: null,
    pilotReason: '光学 PBL 模板进入试点（bootstrap）',
    refused: [],
    teachingBundleFile: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--quality-review') out.qualityReview = true;
    if (arg === '--team-version-id') out.teamVersionId = argv[index + 1] ?? null;
    if (arg === '--teaching-bundle-file') out.teachingBundleFile = argv[index + 1] ?? null;
    if (arg === '--admin-user-id') out.adminUserId = argv[index + 1] ?? null;
    if (arg === '--pilot-reason') out.pilotReason = argv[index + 1] ?? out.pilotReason;
    if (arg === '--publish') out.refused.push('publish');
    if (arg === '--verify') out.refused.push('verify');
  }
  return out;
}

@Module({
  imports: [DatabaseModule, IdempotencyModule, AuditModule, TemplatesModule],
})
class OpticsBootstrapModule {}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));

  // 发布 / 验证是本脚本的永久禁区：明确拒绝，而非静默忽略。
  if (cli.refused.length > 0) {
    console.error(
      `[optics-bootstrap] 拒绝执行 ${cli.refused.join('/')}：本脚本只做 create → pilot → binding。` +
        `发布与验证必须由操作员手动执行，${RUNBOOK_POINTER}。`,
    );
    process.exitCode = 2;
    return;
  }

  if (cli.teamVersionId === null) {
    console.error('[optics-bootstrap] 缺少必填参数 --team-version-id <id>');
    process.exitCode = 2;
    return;
  }

  const adminId = cli.adminUserId ?? 'admin-optics-bootstrap';
  const actor: CurrentUser = {
    id: adminId,
    email: `${adminId}@qitu.local`,
    displayName: '光学模板引导',
    role: 'admin',
  };

  const app = await NestFactory.createApplicationContext(OpticsBootstrapModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const governance = app.get(TemplateGovernanceService);
    const bindings = app.get(TemplateBindingService);
    const templates = app.select(TemplatesModule).get(TemplateStore);
    const bindingStore = app.select(TemplatesModule).get(TemplateBindingStore);

    const report = await runOpticsTemplateBootstrap(
      { governance, bindings, templates, bindingStore },
      { teamVersionId: cli.teamVersionId, actor, pilotReason: cli.pilotReason,
        qualityReview: cli.qualityReview,
        ...(cli.teachingBundleFile ? { teachingBundle: JSON.parse(readFileSync(cli.teachingBundleFile, 'utf8')) } : {}) },
    );

    console.log('[optics-bootstrap] 完成。');
    for (const step of report.steps) {
      console.log(`  - ${step.step}: ${step.action} (${step.detail})`);
    }
    console.log(`  - templateId=${report.templateId}`);
    console.log(`  - versionId=${report.versionId}`);
    console.log(`  - bindingId=${report.bindingId ?? '(none)'}`);
    console.log(`  - 拒绝动作：${report.refusedActions.join(', ')}（${RUNBOOK_POINTER}）`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[optics-bootstrap] 失败：${message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main();
}
