import 'reflect-metadata';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { CurrentUser, PblTemplateTeamBinding } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { InMemoryTemplateViewerDirectory } from './template-evidence.store';
import { TemplateBindingService } from './templates-binding.service';
import {
  InMemoryTemplateBindingStore,
  TemplateBindingStoreConflictError,
} from './templates-binding.store';
import type { TeamVersionRecord } from './templates-binding.types';
import { InMemoryTemplateStore } from './templates.store';
import {
  actor,
  DEFAULT_STAGES,
  FakeAuditWriter,
  FakeIdempotencyStore,
} from './templates.test-support';

const ADMIN = actor('admin', 'admin-1');

const NOW = new Date('2025-01-01T00:00:00Z');

function validTeamVersion(
  id: string,
  overrides: Partial<TeamVersionRecord> = {},
): TeamVersionRecord {
  return {
    id,
    teamId: 'team-1',
    version: 1,
    name: '循迹小车团队',
    description: 'A 组',
    workspaceMode: 'shared',
    sessionMode: 'auto',
    leaderAssistantId: 'assistant-1',
    members: [{ userId: 'student-1' }],
    pblSpec: { phases: ['research', 'build'], curriculumVersion: 4 },
    enabled: true,
    createdBy: 'admin-1',
    createdAt: NOW,
    ...overrides,
  };
}

interface BindingHarness {
  service: TemplateBindingService;
  templates: InMemoryTemplateStore;
  directory: InMemoryTemplateViewerDirectory;
  bindings: InMemoryTemplateBindingStore;
  idempotency: FakeIdempotencyStore;
  audit: FakeAuditWriter;
}

/**
 * 运行时形状断言（B1）：把契约 `AdminBindingMutationResponse` 的内层形状
 * 钉死在测试里，服务端未来若多塞/漏塞字段会在本测试直接失败。
 */
function assertMutationResultShape(result: { binding: PblTemplateTeamBinding; replayed: boolean }): void {
  assert.deepEqual(Object.keys(result).sort(), ['binding', 'replayed']);
  assert.equal(typeof result.replayed, 'boolean');
  assertBindingViewShape(result.binding);
}

function assertBindingViewShape(binding: PblTemplateTeamBinding): void {
  assert.deepEqual(
    Object.keys(binding).sort(),
    [
      'activatedAt',
      'bindingHash',
      'bundleDigest',
      'createdAt',
      'createdBy',
      'id',
      'retiredAt',
      'status',
      'teamVersionId',
      'templateVersionId',
      'updatedAt',
      'validation',
    ],
  );
  assert.deepEqual(Object.keys(binding.validation).sort(), [
    'checkedAt',
    'errors',
    'valid',
    'warnings',
  ]);
  assert.equal(typeof binding.validation.valid, 'boolean');
  assert.ok(Array.isArray(binding.validation.errors));
  assert.ok(Array.isArray(binding.validation.warnings));
  assert.equal(typeof binding.id, 'string');
  assert.equal(typeof binding.templateVersionId, 'string');
  assert.equal(typeof binding.teamVersionId, 'string');
  assert.equal(typeof binding.bindingHash, 'string');
  assert.equal(typeof binding.createdAt, 'string');
  assert.equal(typeof binding.updatedAt, 'string');
}

function makeBindingHarness(): BindingHarness {
  const templates = new InMemoryTemplateStore();
  const directory = new InMemoryTemplateViewerDirectory();
  const bindings = new InMemoryTemplateBindingStore();
  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const service = new TemplateBindingService(
    templates,
    directory,
    bindings,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
  );
  return { service, templates, directory, bindings, idempotency, audit };
}

async function seedPublishedVersion(
  h: BindingHarness,
): Promise<{ templateId: string; versionId: string }> {
  await h.templates.createTemplate({
    id: 'tpl-1',
    schoolId: null,
    slug: 'mini-robot',
    title: '迷你机器人',
    summary: '循迹小车',
    createdBy: 'admin-1',
    now: NOW,
  });
  await h.templates.setTemplateStatus('tpl-1', 'published', 'admin-1', NOW, NOW);
  await h.templates.createVersion({
    id: 'ver-1',
    templateId: 'tpl-1',
    version: 'v1',
    stages: DEFAULT_STAGES,
    content: { materials: ['主板'] },
    rubric: [{ id: 'r1', label: '能循迹' }],
    createdBy: 'admin-1',
    now: NOW,
  });
  await h.templates.setVersionStatus('ver-1', 'published', NOW, NOW);
  return { templateId: 'tpl-1', versionId: 'ver-1' };
}

async function assertHttpError(
  fn: () => Promise<unknown>,
  status: number,
  code?: string,
): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    const http = error as { getStatus?: () => number; getResponse?: () => unknown };
    assert.equal(http.getStatus?.(), status);
    if (code !== undefined) {
      const response = http.getResponse?.() as { code?: string } | undefined;
      assert.equal(response?.code, code);
    }
    return true;
  });
}

describe('TemplateBindingService（F2 绑定生命周期 + F3 冻结/回填）', () => {
  let h: BindingHarness;
  let published: { templateId: string; versionId: string };

  beforeEach(async () => {
    h = makeBindingHarness();
    published = await seedPublishedVersion(h);
    h.bindings.seedTeamVersion(validTeamVersion('tv-1'));
  });

  it('PBL template refuses validation until a compiled Teaching Bundle digest is attached', async () => {
    await h.templates.createVersion({
      id: 'ver-pbl', templateId: published.templateId, version: 'v2', stages: DEFAULT_STAGES,
      content: { pbl: { contractVersion: 'qitu.pbl.v1' } }, rubric: [], createdBy: ADMIN.id, now: NOW,
    });
    await h.templates.setVersionStatus('ver-pbl', 'published', NOW, NOW);
    const created = await h.service.createBinding(ADMIN, published.templateId, 'ver-pbl', { teamVersionId: 'tv-1' }, 'pbl-create');
    await assertHttpError(
      () => h.service.validateBinding(ADMIN, published.templateId, 'ver-pbl', created.binding.id, 'pbl-validate'),
      400,
      'BUNDLE_COMPILATION_UNAVAILABLE',
    );
  });

  it('create → validate → activate → retire 全链路 + 审计动作', async () => {
    const created = await h.service.createBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      { teamVersionId: 'tv-1' },
      'k-create',
    );
    assertMutationResultShape(created);
    assert.equal(created.binding.status, 'draft');
    assert.equal(created.replayed, false);
    assert.ok(created.binding.bindingHash.length > 0);

    const validated = await h.service.validateBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      'k-validate',
    );
    assertMutationResultShape(validated);
    assert.equal(validated.binding.status, 'validated');
    assert.equal(validated.binding.validation.valid, true);

    const activated = await h.service.activateBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      'k-activate',
    );
    assertMutationResultShape(activated);
    assert.equal(activated.binding.status, 'active');
    assert.ok(activated.binding.activatedAt !== null);

    const retired = await h.service.retireBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      { reason: '团队解散' },
      'k-retire',
    );
    assertMutationResultShape(retired);
    assert.equal(retired.binding.status, 'retired');
    assert.ok(retired.binding.retiredAt !== null);

    const actions = h.audit.entries.map((entry) => entry.action);
    for (const action of [
      'template.binding.create',
      'template.binding.validate',
      'template.binding.activate',
      'template.binding.retire',
    ]) {
      assert.ok(actions.includes(action), `缺少审计动作 ${action}`);
    }
  });

  it('同键重放不重复执行；同键异载荷 409', async () => {
    const first = await h.service.createBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      { teamVersionId: 'tv-1' },
      'k-replay',
    );
    const replay = await h.service.createBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      { teamVersionId: 'tv-1' },
      'k-replay',
    );
    assertMutationResultShape(replay);
    assert.equal(replay.replayed, true);
    assert.equal(replay.binding.id, first.binding.id);
    assert.equal(h.idempotency.executions, 1);

    h.bindings.seedTeamVersion(validTeamVersion('tv-other', { version: 2 }));
    await assertHttpError(
      () =>
        h.service.createBinding(
          ADMIN,
          published.templateId,
          published.versionId,
          { teamVersionId: 'tv-other' },
          'k-replay',
        ),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('非法迁移：draft 直接 activate → 409 BINDING_TRANSITION_INVALID', async () => {
    const created = await h.service.createBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      { teamVersionId: 'tv-1' },
      'k-draft-activate',
    );
    await assertHttpError(
      () =>
        h.service.activateBinding(
          ADMIN,
          published.templateId,
          published.versionId,
          created.binding.id,
          'k-bad-activate',
        ),
      409,
      'BINDING_TRANSITION_INVALID',
    );
  });

  it('retired 是终态：再 activate → 409 BINDING_TRANSITION_INVALID', async () => {
    const created = await h.service.createBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      { teamVersionId: 'tv-1' },
      'k-terminal-create',
    );
    await h.service.validateBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      'k-terminal-validate',
    );
    await h.service.activateBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      'k-terminal-activate',
    );
    await h.service.retireBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      { reason: '完成' },
      'k-terminal-retire',
    );
    await assertHttpError(
      () =>
        h.service.activateBinding(
          ADMIN,
          published.templateId,
          published.versionId,
          created.binding.id,
          'k-terminal-reactivate',
        ),
      409,
      'BINDING_TRANSITION_INVALID',
    );
  });

  it('双激活兜底：存储层冲突 → 409 BINDING_CONFLICT', async () => {
    const created = await h.service.createBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      { teamVersionId: 'tv-1' },
      'k-conflict-create',
    );
    await h.service.validateBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      'k-conflict-validate',
    );

    // 模拟局部唯一索引拒绝并发双激活。
    const original = h.bindings.activateBinding.bind(h.bindings);
    h.bindings.activateBinding = async () => {
      throw new TemplateBindingStoreConflictError('并发双激活');
    };
    try {
      await assertHttpError(
        () =>
          h.service.activateBinding(
            ADMIN,
            published.templateId,
            published.versionId,
            created.binding.id,
            'k-conflict-activate',
          ),
        409,
        'BINDING_CONFLICT',
      );
    } finally {
      h.bindings.activateBinding = original;
    }
  });

  it('piloting 版本可创建并激活绑定（试点需绑定才能解析团队）', async () => {
    const pilotTemplate = await h.templates.createTemplate({
      id: 'tpl-pilot',
      schoolId: null,
      slug: 'optics-pilot',
      title: '物理光学（试点）',
      summary: '干涉衍射偏振',
      createdBy: 'admin-1',
      now: NOW,
    });
    await h.templates.createVersion({
      id: 'ver-pilot',
      templateId: pilotTemplate.id,
      version: 'v1',
      stages: DEFAULT_STAGES,
      createdBy: 'admin-1',
      now: NOW,
    });
    await h.templates.setVersionStatus('ver-pilot', 'piloting', NOW, NOW);

    const created = await h.service.createBinding(
      ADMIN,
      pilotTemplate.id,
      'ver-pilot',
      { teamVersionId: 'tv-1' },
      'k-pilot-create',
    );
    await h.service.validateBinding(
      ADMIN,
      pilotTemplate.id,
      'ver-pilot',
      created.binding.id,
      'k-pilot-validate',
    );
    const activated = await h.service.activateBinding(
      ADMIN,
      pilotTemplate.id,
      'ver-pilot',
      created.binding.id,
      'k-pilot-activate',
    );
    assert.equal(activated.binding.status, 'active');
  });

  it('绑定只允许指向 published 或 piloting 版本；draft 版本 404', async () => {
    const draftTemplate = await h.templates.createTemplate({
      id: 'tpl-2',
      schoolId: null,
      slug: 'draft-template',
      title: '草稿模板',
      summary: '未发布',
      createdBy: 'admin-1',
      now: NOW,
    });
    await h.templates.createVersion({
      id: 'ver-draft',
      templateId: draftTemplate.id,
      version: 'v1',
      stages: DEFAULT_STAGES,
      createdBy: 'admin-1',
      now: NOW,
    });
    await assertHttpError(
      () =>
        h.service.createBinding(
          ADMIN,
          draftTemplate.id,
          'ver-draft',
          { teamVersionId: 'tv-1' },
          'k-draft-version',
        ),
      404,
      'BINDING_TEMPLATE_VERSION_NOT_FOUND',
    );
  });

  it('校验未通过：disabled 团队 → 400 BINDING_INVALID 且状态保持 draft', async () => {
    h.bindings.seedTeamVersion(validTeamVersion('tv-disabled', { enabled: false }));
    const created = await h.service.createBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      { teamVersionId: 'tv-disabled' },
      'k-invalid-create',
    );
    await assertHttpError(
      () =>
        h.service.validateBinding(
          ADMIN,
          published.templateId,
          published.versionId,
          created.binding.id,
          'k-invalid-validate',
        ),
      400,
      'BINDING_INVALID',
    );
    const row = await h.bindings.findBinding(created.binding.id);
    assert.equal(row?.status, 'draft');
    assert.equal(row?.validation.valid, false);
    assert.deepEqual(row?.validation.errors, ['TEAM_VERSION_DISABLED']);
  });

  it('preview：返回 active 绑定与受影响项目；review 版本也可预览', async () => {
    // 先把 review 版本搭起来：模板状态不影响 B5 预览（只校验版本状态）。
    const reviewTemplate = await h.templates.createTemplate({
      id: 'tpl-review',
      schoolId: null,
      slug: 'review-template',
      title: '评审模板',
      summary: '评审中',
      createdBy: 'admin-1',
      now: NOW,
    });
    await h.templates.createVersion({
      id: 'ver-review',
      templateId: reviewTemplate.id,
      version: 'v1',
      stages: DEFAULT_STAGES,
      createdBy: 'admin-1',
      now: NOW,
    });
    await h.templates.setVersionStatus('ver-review', 'review', null, NOW);
    h.bindings.seedAffectedProjects('ver-review', [
      { projectId: 'proj-1', studentUserId: 'student-1', title: '循迹小车', planId: 'plan-1' },
    ]);

    const preview = await h.service.previewBindings(ADMIN, reviewTemplate.id, 'ver-review');
    assert.equal(preview.activeBinding, null);
    assert.equal(preview.affectedProjects.length, 1);
    assert.equal(preview.affectedProjects[0]?.projectId, 'proj-1');
  });

  it('resolveActiveBinding / findActiveBindingForTemplate：无绑定返回 null', async () => {
    assert.equal(await h.service.resolveActiveBinding(published.versionId), null);
    assert.equal(await h.service.findActiveBindingForTemplate(published.versionId), null);
  });

  it('freezeProjectBinding：active 绑定冻结 `backfilled=false`；无绑定返回 omitted', async () => {
    assert.equal(
      await h.service.freezeProjectBinding({
        projectId: 'proj-1',
        templateVersionId: published.versionId,
        boundAt: NOW,
      }),
      'omitted',
    );

    const created = await h.service.createBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      { teamVersionId: 'tv-1' },
      'k-freeze-create',
    );
    await h.service.validateBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      'k-freeze-validate',
    );
    await h.service.activateBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      'k-freeze-activate',
    );

    assert.equal(
      await h.service.freezeProjectBinding({
        projectId: 'proj-1',
        templateVersionId: published.versionId,
        boundAt: NOW,
      }),
      'frozen',
    );
    const snapshot = await h.bindings.findSnapshot('proj-1');
    assert.equal(snapshot?.bindingId, created.binding.id);
    assert.equal(snapshot?.backfilled, false);
  });

  it('resolveSnapshotForProject：miss 时按 active 绑定回填 `backfilled=true` 并审计', async () => {
    const created = await h.service.createBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      { teamVersionId: 'tv-1' },
      'k-backfill-create',
    );
    await h.service.validateBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      'k-backfill-validate',
    );
    await h.service.activateBinding(
      ADMIN,
      published.templateId,
      published.versionId,
      created.binding.id,
      'k-backfill-activate',
    );

    const resolved = await h.service.resolveSnapshotForProject(
      'proj-old',
      published.versionId,
      ADMIN,
    );
    assert.ok(resolved !== null);
    assert.equal(resolved.backfilled, true);
    assert.equal(resolved.bindingId, created.binding.id);
    assert.equal(
      h.audit.entries.some((entry) => entry.action === 'project.binding.backfill'),
      true,
    );

    // 再次读取命中快照，不重复回填。
    h.audit.entries.length = 0;
    const again = await h.service.resolveSnapshotForProject('proj-old', published.versionId, ADMIN);
    assert.equal(again?.bindingId, created.binding.id);
    assert.equal(
      h.audit.entries.some((entry) => entry.action === 'project.binding.backfill'),
      false,
    );
  });

  it('resolveSnapshotForProject：无绑定返回 null，不报错、不回填', async () => {
    const resolved = await h.service.resolveSnapshotForProject(
      'proj-none',
      published.versionId,
      ADMIN,
    );
    assert.equal(resolved, null);
    assert.equal(h.audit.entries.length, 0);
  });

  it('runtime snapshot reads are side-effect free and reject backfilled, mismatched or corrupt bindings', async () => {
    const created = await h.service.createBinding(
      ADMIN, published.templateId, published.versionId, { teamVersionId: 'tv-1' }, 'runtime-create',
    );
    await h.service.validateBinding(ADMIN, published.templateId, published.versionId, created.binding.id, 'runtime-validate');
    await h.service.activateBinding(ADMIN, published.templateId, published.versionId, created.binding.id, 'runtime-activate');
    h.audit.entries.length = 0;

    assert.equal(await h.service.findFrozenSnapshotForProject('legacy', published.versionId), null);
    assert.equal(await h.bindings.findSnapshot('legacy'), null);
    assert.equal(h.audit.entries.length, 0);

    await h.service.freezeProjectBinding({ projectId: 'confirmed', templateVersionId: published.versionId, boundAt: NOW });
    assert.equal((await h.service.findFrozenSnapshotForProject('confirmed', published.versionId))?.bindingId, created.binding.id);
    assert.equal(await h.service.findFrozenSnapshotForProject('confirmed', 'another-version'), null);
    assert.equal(await h.service.findFrozenSnapshotForProject('confirmed', null), null);

    const frozen = (await h.bindings.findSnapshot('confirmed'))!;
    await h.bindings.insertSnapshot({ ...frozen, projectId: 'backfilled', backfilled: true });
    await h.bindings.insertSnapshot({ ...frozen, projectId: 'corrupt', bindingHash: 'not-the-frozen-hash' });
    assert.equal(await h.service.findFrozenSnapshotForProject('backfilled', published.versionId), null);
    assert.equal(await h.service.findFrozenSnapshotForProject('corrupt', published.versionId), null);
    assert.equal(h.audit.entries.length, 0);
  });
});
