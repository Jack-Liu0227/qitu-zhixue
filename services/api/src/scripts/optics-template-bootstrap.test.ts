import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import type { AuditWriter } from '../common/audit/audit.service';
import type { IdempotencyStore } from '../common/idempotency/idempotency.service';
import {
  InMemoryTemplateEvidenceSource,
  InMemoryTemplateViewerDirectory,
} from '../modules/templates/template-evidence.store';
import { InMemoryTemplateVerificationStore } from '../modules/templates/template-verification.store';
import { TemplateBindingService } from '../modules/templates/templates-binding.service';
import { InMemoryTemplateBindingStore } from '../modules/templates/templates-binding.store';
import {
  computeBindingHash,
  computePblSpecHash,
  newBindingId,
  type TeamVersionRecord,
} from '../modules/templates/templates-binding.types';
import { TemplateGovernanceService } from '../modules/templates/templates-governance.service';
import { InMemoryTemplateStore } from '../modules/templates/templates.store';
import {
  actor,
  FakeAuditWriter,
  FakeIdempotencyStore,
} from '../modules/templates/templates.test-support';
import {
  assertOpticsTemplateStructure,
  OPTICS_BOOTSTRAP_KEY,
  OPTICS_TEMPLATE_INPUT,
  OPTICS_VERSION_INPUT,
} from '../modules/templates/content/optics';
import {
  OpticsBootstrapError,
  runOpticsTemplateBootstrap,
  type OpticsBootstrapReport,
} from './optics-template-bootstrap';

const ADMIN = actor('admin', 'admin-1');
const NOW = new Date('2025-01-01T00:00:00Z');
const TEAM_VERSION_ID = 'tv-optics-1';

function validTeamVersion(
  id: string,
  overrides: Partial<TeamVersionRecord> = {},
): TeamVersionRecord {
  return {
    id,
    teamId: 'team-optics',
    version: 1,
    name: '光学探究团队',
    description: 'A 组',
    workspaceMode: 'shared',
    sessionMode: 'auto',
    leaderAssistantId: 'optics-concept-coach',
    members: [{ userId: 'student-1' }],
    pblSpec: {
      phases: ['exploration', 'concept_mastery', 'guided_practice', 'deliverable_review'],
    },
    enabled: true,
    createdBy: 'admin-1',
    createdAt: NOW,
    ...overrides,
  };
}

interface BootstrapHarness {
  governance: TemplateGovernanceService;
  bindings: TemplateBindingService;
  templates: InMemoryTemplateStore;
  bindingStore: InMemoryTemplateBindingStore;
  audit: FakeAuditWriter;
}

function makeBootstrapHarness(): BootstrapHarness {
  const templates = new InMemoryTemplateStore();
  const evidence = new InMemoryTemplateEvidenceSource();
  const verification = new InMemoryTemplateVerificationStore();
  const directory = new InMemoryTemplateViewerDirectory();
  const bindingStore = new InMemoryTemplateBindingStore();
  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const governance = new TemplateGovernanceService(
    templates,
    evidence,
    verification,
    directory,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
  );
  const bindings = new TemplateBindingService(
    templates,
    directory,
    bindingStore,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
  );
  return { governance, bindings, templates, bindingStore, audit };
}

function run(h: BootstrapHarness, teamVersionId = TEAM_VERSION_ID): Promise<OpticsBootstrapReport> {
  return runOpticsTemplateBootstrap(
    {
      governance: h.governance,
      bindings: h.bindings,
      templates: h.templates,
      bindingStore: h.bindingStore,
    },
    { teamVersionId, actor: ADMIN, pilotReason: 'test pilot' },
  );
}

describe('optics-template-bootstrap（光学模板引导）', () => {
  let h: BootstrapHarness;

  beforeEach(() => {
    h = makeBootstrapHarness();
    h.bindingStore.seedTeamVersion(validTeamVersion(TEAM_VERSION_ID));
  });

  it('结构校验通过，且版本正文携带幂等解析标记', () => {
    assert.doesNotThrow(() => assertOpticsTemplateStructure());
    const content = OPTICS_VERSION_INPUT.content;
    assert.ok(content !== undefined, '版本正文存在');
    assert.equal(content.bootstrapKey, OPTICS_BOOTSTRAP_KEY);
  });

  it('完整链路：create → pilot → binding create → validate → activate，且永不 verify/publish', async () => {
    const report = await run(h);

    assert.ok(report.templateId.startsWith('tpl-'), '模板 id 存在');
    assert.ok(report.versionId.startsWith('tplv-'), '版本 id 存在');
    assert.ok(report.bindingId !== null, '绑定 id 存在');

    const version = await h.templates.findVersion(report.versionId);
    assert.equal(version?.status, 'piloting', '版本应处于试点');

    const active = await h.bindingStore.findActiveBinding(report.versionId);
    assert.equal(active?.id, report.bindingId, '存在 active 绑定');
    assert.equal(active?.teamVersionId, TEAM_VERSION_ID);

    // 拒绝动作显式列出 verify / publish。
    assert.deepEqual(report.refusedActions, [
      'template.version.verify',
      'template.version.publish',
    ]);

    // 审计里不得出现 verify / publish 动作。
    const forbiddenActions = h.audit.entries
      .map((entry) => entry.action)
      .filter(
        (action) => action === 'template.version.verify' || action === 'template.version.publish',
      );
    assert.deepEqual(forbiddenActions, [], 'bootstrap 不得写 verify/publish 审计');
  });

  it('重跑幂等：复用同一模板 / 版本 / 绑定，不产生第二个', async () => {
    const first = await run(h);
    const second = await run(h);

    assert.equal(second.templateId, first.templateId, '模板复用');
    assert.equal(second.versionId, first.versionId, '版本复用');
    assert.equal(second.bindingId, first.bindingId, '绑定复用');

    const actions = second.steps.map((step) => step.action);
    assert.ok(
      actions.every((action) => action === 'reuse' || action === 'noop'),
      '重跑应全部 reuse/noop',
    );

    const bindings = await h.bindingStore.listBindings(first.versionId);
    assert.equal(bindings.length, 1, '只存在一个绑定');
  });

  it('绑定草稿残留（中断后重跑）：validate → activate 续跑，不新建绑定', async () => {
    // 手动构造「模板 + 版本 + pilot + 一个 draft 绑定」的中断现场。
    const createdTemplate = await h.governance.createTemplate(
      ADMIN,
      OPTICS_TEMPLATE_INPUT,
      'seed-template',
    );
    const createdVersion = await h.governance.createVersion(
      ADMIN,
      createdTemplate.template.id,
      OPTICS_VERSION_INPUT,
      'seed-version',
    );
    await h.governance.pilotVersion(
      ADMIN,
      createdTemplate.template.id,
      createdVersion.version.id,
      'seed-pilot',
      '中断现场',
    );

    const version = await h.templates.findVersion(createdVersion.version.id);
    assert.ok(version !== null, '试点后版本存在');

    const teamVersion = validTeamVersion(TEAM_VERSION_ID);
    const bindingHash = computeBindingHash(
      version.id,
      TEAM_VERSION_ID,
      computePblSpecHash(teamVersion),
    );
    await h.bindingStore.createBinding({
      id: newBindingId(),
      templateVersionId: version.id,
      teamVersionId: TEAM_VERSION_ID,
      bindingHash,
      createdBy: ADMIN.id,
      now: NOW,
    });

    const report = await run(h);
    assert.equal(report.versionId, version.id, '复用中断现场的版本');

    const bindings = await h.bindingStore.listBindings(version.id);
    assert.equal(bindings.length, 1, '不新建第二个绑定');
    assert.equal(bindings[0]?.status, 'active', '续跑后绑定 active');
    assert.equal(report.bindingId, bindings[0]?.id, '报告返回同一个绑定');
  });

  it('缺少团队版本时 fail loudly', async () => {
    await assert.rejects(run(h, 'tv-missing'), (error: unknown) => {
      assert.ok(error instanceof OpticsBootstrapError, '应抛 OpticsBootstrapError');
      assert.match((error as Error).message, /团队版本不存在/);
      return true;
    });
  });

  it('绑定校验未通过（团队被禁用）时 fail loudly，不落 active 绑定', async () => {
    h.bindingStore.seedTeamVersion(validTeamVersion('tv-disabled', { enabled: false }));

    await assert.rejects(run(h, 'tv-disabled'), (error: unknown) => {
      const http = error as { getStatus?: () => number; getResponse?: () => unknown };
      assert.equal(http.getStatus?.(), 400, '绑定校验失败应为 400');
      const response = http.getResponse?.() as { code?: string } | undefined;
      assert.equal(response?.code, 'BINDING_INVALID', '错误码应为 BINDING_INVALID');
      return true;
    });

    // 版本已试点、模板已建，但不该有 active 绑定。
    const template = await h.templates.findTemplateBySlug(null, 'optics-physical-inquiry');
    assert.ok(template !== null);
    const version = (await h.templates.listVersions(template.id))[0];
    assert.ok(version !== undefined);
    assert.equal(await h.bindingStore.findActiveBinding(version.id), null, '无 active 绑定');
  });
});
