import 'reflect-metadata';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { CurrentUser } from '@qitu/contracts';
import {
  actor,
  DEFAULT_STAGES,
  fullEvidence,
  makeGovernanceHarness,
  VALID_CREATE_INPUT,
  type GovernanceHarness,
} from './templates.test-support';

const ADMIN = actor('admin', 'admin-1');
const TEACHER_A = actor('teacher', 'teacher-a');
const TEACHER_B = actor('teacher', 'teacher-b');

const VERSION_INPUT = {
  stages: DEFAULT_STAGES,
  content: { materials: ['主板'], steps: ['搭建', '调试'] },
  rubric: [{ id: 'r1', label: '能循迹' }],
};

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

interface Created {
  templateId: string;
  versionId: string;
}

async function createDraftTemplate(
  harness: GovernanceHarness,
  owner: CurrentUser = ADMIN,
  overrides: Partial<typeof VALID_CREATE_INPUT> = {},
  key = `create-${Math.random()}`,
): Promise<Created> {
  const created = await harness.service.createTemplate(
    owner,
    { ...VALID_CREATE_INPUT, ...overrides },
    key,
  );
  const version = await harness.service.createVersion(
    owner,
    created.template.id,
    VERSION_INPUT,
    `version-${Math.random()}`,
  );
  return { templateId: created.template.id, versionId: version.version.id };
}

describe('TemplateGovernanceService（治理写 + 验证晋升）', () => {
  let harness: GovernanceHarness;

  beforeEach(() => {
    harness = makeGovernanceHarness();
    harness.directory.setSchoolId(TEACHER_A.id, 'school-a');
    harness.directory.setSchoolId(TEACHER_B.id, 'school-b');
  });

  it('创建模板：draft 落库 + 审计；同键重放不重复创建', async () => {
    const first = await harness.service.createTemplate(ADMIN, VALID_CREATE_INPUT, 'k-create');
    assert.equal(first.template.status, 'draft');
    assert.equal(first.replayed, false);
    assert.equal(harness.audit.entries.at(-1)?.action, 'template.create');

    const replay = await harness.service.createTemplate(ADMIN, VALID_CREATE_INPUT, 'k-create');
    assert.equal(replay.replayed, true);
    assert.equal(replay.template.id, first.template.id);
    assert.equal((await harness.store.listTemplates({})).length, 1);
  });

  it('客户端传入 status / verifiedBy 等服务端字段被忽略，仍是 draft', async () => {
    const created = await harness.service.createTemplate(
      ADMIN,
      { ...VALID_CREATE_INPUT, status: 'published', verifiedBy: 'attacker' } as never,
      'k-inject',
    );
    assert.equal(created.template.status, 'draft');
    const row = await harness.store.findTemplate(created.template.id);
    assert.equal(row?.status, 'draft');
    assert.equal(row?.verifiedBy, null);
  });

  it('同校 slug 冲突 409', async () => {
    await harness.service.createTemplate(ADMIN, VALID_CREATE_INPUT, 'k-1');
    await assertHttpError(
      () => harness.service.createTemplate(ADMIN, VALID_CREATE_INPUT, 'k-2'),
      409,
      'TEMPLATE_CONFLICT',
    );
  });

  it('teacher 建校属模板强制绑定本校，指定他校 403', async () => {
    const created = await harness.service.createTemplate(
      TEACHER_A,
      { ...VALID_CREATE_INPUT, slug: 'teacher-a-1' },
      'k-ta',
    );
    assert.equal(created.template.schoolId, 'school-a');

    await assertHttpError(
      () =>
        harness.service.createTemplate(
          TEACHER_A,
          { ...VALID_CREATE_INPUT, slug: 'teacher-a-2', schoolId: 'school-b' },
          'k-ta-2',
        ),
      403,
    );
  });

  it('版本阶段校验：重复 stage id 400', async () => {
    const created = await harness.service.createTemplate(
      ADMIN,
      { ...VALID_CREATE_INPUT, slug: 'bad-stages' },
      'k-bad',
    );
    await assertHttpError(
      () =>
        harness.service.createVersion(
          ADMIN,
          created.template.id,
          { stages: [{ id: 'x', label: 'A' }, { id: 'x', label: 'B' }] },
          'k-bad-version',
        ),
      400,
      'TEMPLATE_INPUT_INVALID',
    );
  });

  it('验证未完成时拒绝发布并保持 draft（可修正后重试同键）', async () => {
    const { templateId, versionId } = await createDraftTemplate(harness, ADMIN, { slug: 'incomplete' });

    const verified = await harness.service.verifyVersion(ADMIN, templateId, versionId, 'k-verify');
    assert.equal(verified.report.passed, false);
    assert.equal(harness.audit.entries.at(-1)?.action, 'template.version.verify');

    await assertHttpError(
      () => harness.service.publishVersion(ADMIN, templateId, versionId, 'k-publish', '首次发布'),
      409,
      'TEMPLATE_VERIFICATION_INCOMPLETE',
    );
    assert.equal((await harness.store.findVersion(versionId))?.status, 'draft');
    assert.equal((await harness.store.findTemplate(templateId))?.status, 'draft');

    // 补齐证据后同键重试 → 通过（幂等失败可重试）。
    harness.evidence.seed(fullEvidence(versionId));
    const published = await harness.service.publishVersion(
      ADMIN,
      templateId,
      versionId,
      'k-publish',
      '补齐证据后发布',
    );
    assert.equal(published.report.passed, true);
    assert.equal(published.version.status, 'published');
    assert.equal(published.template.status, 'published');
  });

  it('五项证据齐全 → 晋升 published 并写审计', async () => {
    const { templateId, versionId } = await createDraftTemplate(harness, ADMIN, { slug: 'complete' });
    harness.evidence.seed(fullEvidence(versionId));

    const result = await harness.service.publishVersion(
      ADMIN,
      templateId,
      versionId,
      'k-publish-2',
      '首版发布',
    );
    assert.equal(result.replayed, false);
    assert.equal(result.version.status, 'published');
    assert.ok(result.version.publishedAt !== null);
    assert.equal(result.template.status, 'published');
    assert.equal(result.template.latestPublishedVersionId, versionId);

    const row = await harness.store.findTemplate(templateId);
    assert.equal(row?.verifiedBy, ADMIN.id);
    assert.ok(row?.verifiedAt instanceof Date);
    assert.equal(harness.audit.entries.at(-1)?.action, 'template.version.publish');
  });

  it('发布幂等：同键重放不重复执行；换键再次发布同一版本也返回已发布', async () => {
    const { templateId, versionId } = await createDraftTemplate(harness, ADMIN, { slug: 'replay' });
    harness.evidence.seed(fullEvidence(versionId));

    const before = harness.idempotency.executions;
    const first = await harness.service.publishVersion(ADMIN, templateId, versionId, 'k-p', null);
    assert.equal(harness.idempotency.executions, before + 1);

    const replaySameKey = await harness.service.publishVersion(ADMIN, templateId, versionId, 'k-p', null);
    assert.equal(replaySameKey.replayed, true);
    assert.equal(harness.idempotency.executions, before + 1);

    const replayNewKey = await harness.service.publishVersion(ADMIN, templateId, versionId, 'k-p2', null);
    assert.equal(replayNewKey.replayed, true);
    assert.equal(replayNewKey.version.status, 'published');

    const publishedVersions = (await harness.store.listVersions(templateId)).filter(
      (version) => version.status === 'published',
    );
    assert.equal(publishedVersions.length, 1);
    assert.equal(first.version.publishedAt, replayNewKey.version.publishedAt);
  });

  it('已发布模板不可改元数据；可加新版本；回滚复制为新 draft 且历史版本不变', async () => {
    const { templateId, versionId } = await createDraftTemplate(harness, ADMIN, { slug: 'freeze' });
    harness.evidence.seed(fullEvidence(versionId));
    await harness.service.publishVersion(ADMIN, templateId, versionId, 'k-freeze-publish', null);

    await assertHttpError(
      () => harness.service.updateTemplate(ADMIN, templateId, { title: '改名' }, 'k-update'),
      409,
      'TEMPLATE_TRANSITION_INVALID',
    );

    const v2 = await harness.service.createVersion(ADMIN, templateId, VERSION_INPUT, 'k-v2');
    assert.equal(v2.version.version, 'v2');

    const rolledBack = await harness.service.rollbackTemplate(
      ADMIN,
      templateId,
      versionId,
      'k-rollback',
      '回滚到 v1',
    );
    assert.equal(rolledBack.version.version, 'v3');
    assert.equal(rolledBack.version.status, 'draft');
    assert.deepEqual(rolledBack.version.stages, DEFAULT_STAGES);
    assert.equal(harness.audit.entries.at(-1)?.action, 'template.rollback');

    const source = await harness.store.findVersion(versionId);
    assert.equal(source?.status, 'published');
    assert.equal(source?.version, 'v1');
  });

  it('老师不能治理他校模板（对象级 403）', async () => {
    const { templateId, versionId } = await createDraftTemplate(harness, TEACHER_A, { slug: 'own-a' });
    await assertHttpError(
      () => harness.service.verifyVersion(TEACHER_B, templateId, versionId, 'k-cross'),
      403,
    );
  });

  it('归档后不可再创建版本 / 回滚', async () => {
    const { templateId, versionId } = await createDraftTemplate(harness, ADMIN, { slug: 'archive' });
    await harness.service.archiveTemplate(ADMIN, templateId, 'k-archive', '下线');
    assert.equal((await harness.store.findTemplate(templateId))?.status, 'archived');

    await assertHttpError(
      () => harness.service.createVersion(ADMIN, templateId, VERSION_INPUT, 'k-archive-v'),
      409,
      'TEMPLATE_TRANSITION_INVALID',
    );
    await assertHttpError(
      () => harness.service.rollbackTemplate(ADMIN, templateId, versionId, 'k-archive-r', null),
      409,
      'TEMPLATE_TRANSITION_INVALID',
    );
  });
});
