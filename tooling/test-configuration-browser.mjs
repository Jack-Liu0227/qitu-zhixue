import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

/** Run against preview-configuration-bindings.mjs with a Playwright Page. All writes stay in response fixtures. */
export default async function verifyConfigurationBrowser(page) {
  const fixture = JSON.parse(readFileSync(new URL('../services/api/.tmp/configuration-browser/fixtures.json', import.meta.url), 'utf8'));
  const origin = 'http://127.0.0.1:3204';
  const now = '2026-10-21T00:00:00.000Z';
  const templateId = 'configuration-template';
  const versionId = 'configuration-version';
  const base = `/api/v1/admin/project-templates/${templateId}/versions/${versionId}/bindings`;
  const template = { id: templateId, slug: 'fixture', title: 'Synthetic optics', summary: 'Fixture only', status: 'published',
    schoolId: null, latestPublishedVersionId: versionId, learningObjectives: [], updatedAt: now };
  const spec = { ...fixture.template, phases: fixture.template.phases.map(phase => ({ ...phase, assignedAssistantId: null })) };
  let version = { id: versionId, templateId, version: 'v1', status: 'published', content: { pbl: spec },
    stages: [], rubric: [], publishedAt: now, createdAt: now, createdBy: 'fixture-admin' };
  const team = { id: fixture.team.teamId, name: 'Synthetic teaching team', enabled: true, updatedAt: now };
  const versions = [{ id: 'legacy-team', teamId: team.id, version: 1, name: team.name, runtimeSnapshotStatus: 'legacy_unpinned', members: [] }];
  const rows = [{ binding: { id: 'legacy-binding', templateVersionId: versionId, teamVersionId: 'legacy-team', status: 'active',
    bundleDigest: null, bundleDraft: null, validation: { valid: true }, createdAt: now, updatedAt: now },
    team: { id: team.id, name: team.name, runtimeSnapshotStatus: 'legacy_unpinned' }, configurationReady: false }];
  const recovery = [{ projectId: 'synthetic-history', state: 'legacy' }];
  const modelA = { providerId: 'provider-a', modelId: 'shared-model' };
  let usage = { usageId: 'admin.copilot', providerId: null, modelId: null, resolved: modelA };
  let denyModels = false;
  let denyBindings = false;
  let dropModelWrite = false;
  let courseWrites = 0;
  let modelWrites = 0;
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  await page.unrouteAll({ behavior: 'wait' });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = method === 'GET' ? null : request.postDataJSON();
    const reply = (data, status = 200) => route.fulfill({ status, json: { data } });
    if (path === '/api/v1/admin/model-providers') {
      if (denyModels) return route.fulfill({ status: 403, json: { detail: '模型目录读取被拒绝' } });
      return reply({ providers: ['provider-a', 'provider-b'].map(id => ({ id, name: id, enabled: true, baseUrl: 'https://fixture.invalid',
        api: 'openai-completions', authHeader: true, auth: { configured: true },
        models: [{ id: 'shared-model', name: 'Shared name', input: ['text'], output: ['text'] }] })) });
    }
    if (path === '/api/v1/admin/model-usages') return reply({ usages: [], bindings: [usage] });
    if (path === '/api/v1/admin/model-usages/admin.copilot' && method === 'PATCH') {
      assert.ok(request.headers()['idempotency-key']); modelWrites++;
      if (!dropModelWrite) usage = { usageId: 'admin.copilot', ...body, resolved: { providerId: body.providerId, modelId: body.modelId } };
      return reply(usage);
    }
    if (path === '/api/v1/admin/project-templates') return reply([template]);
    if (path === '/api/v1/admin/ai-runtime/teams') return reply([team]);
    if (path === `/api/v1/admin/teams/${encodeURIComponent(team.id)}/versions`) {
      if (method === 'POST') {
        assert.equal(body.expectedUpdatedAt, team.updatedAt);
        versions.push({ ...fixture.team, runtimeSnapshotStatus: 'published' });
        return reply(versions.at(-1));
      }
      return reply(versions);
    }
    if (path === `/api/v1/admin/project-templates/${templateId}/versions`) {
      if (method === 'POST') {
        courseWrites++;
        version = { ...version, id: `configuration-version-${courseWrites + 1}`, version: `v${courseWrites + 1}`,
          content: body.content, stages: body.stages, rubric: body.rubric, createdAt: new Date().toISOString() };
        return reply({ template, version });
      }
      return reply([version]);
    }
    if (path === `/api/v1/admin/project-templates/${templateId}` && method === 'PATCH') {
      Object.assign(template, body, { updatedAt: new Date().toISOString() }); return reply({ template });
    }
    if (path === base) {
      if (denyBindings) return route.fulfill({ status: 403, json: { detail: '绑定目录读取被拒绝' } });
      if (method === 'POST') {
        const row = { binding: { id: 'new-binding', templateVersionId: versionId, teamVersionId: body.teamVersionId,
          status: 'draft', bundleDigest: null, bundleDraft: null, validation: { valid: false }, createdAt: new Date().toISOString(), updatedAt: now },
          team: { id: team.id, name: team.name, runtimeSnapshotStatus: 'published' }, configurationReady: false };
        rows.push(row); return reply({ binding: row.binding });
      }
      return reply(rows);
    }
    if (path === `${base}/project-recovery`) return reply(recovery);
    const row = rows.find(entry => path.startsWith(`${base}/${entry.binding.id}/`));
    if (row && path.endsWith('/prepare')) {
      assert.equal(body.scheduleProfileId, fixture.draft.scheduleProfileId);
      for (const phase of fixture.template.phases) assert.ok(versions.at(-1).members.some(member => member.slotId === body.phaseAssignments[phase.phase]));
      row.binding.bundleDraft = fixture.draft; row.binding.updatedAt = new Date().toISOString(); return reply({ binding: row.binding });
    }
    if (row && path.endsWith('/validate')) { row.binding.status = 'validated'; return reply({ binding: row.binding }); }
    if (row && path.endsWith('/activate')) {
      rows.forEach(entry => { if (entry !== row) entry.binding.status = 'retired'; });
      Object.assign(row.binding, { status: 'active', bundleDigest: 'a'.repeat(64), validation: { valid: true } });
      row.configurationReady = true; return reply({ binding: row.binding });
    }
    if (row && path.endsWith('/reconfirm')) {
      assert.equal(body.reason, 'Reviewed configuration'); recovery[0].state = 'ready';
      return reply({ projectId: recovery[0].projectId, snapshot: { projectId: recovery[0].projectId, bindingId: row.binding.id }, replayed: false });
    }
    if (method === 'GET' && path.endsWith('/bindings') && path.includes(`/project-templates/${templateId}/versions/`)) return reply([]);
    return route.fulfill({ status: 404, json: { detail: `Unexpected fixture request ${method} ${path}` } });
  });
  const checks = [];
  try {
    await page.goto(`${origin}/model`);
    const selector = page.getByRole('combobox', { name: '管家默认模型' });
    await page.getByRole('button', { name: '设为默认', exact: true }).waitFor();
    await page.getByRole('button', { name: '设为默认', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '默认模型已保存' }).waitFor();
    await page.reload();
    await page.getByRole('status').filter({ hasText: '已读取保存的管家默认模型' }).waitFor();
    assert.equal(await selector.inputValue(), JSON.stringify(['provider-a', 'shared-model']));
    assert.equal(await page.getByRole('button', { name: '设为默认', exact: true }).count(), 0);
    await selector.selectOption(JSON.stringify(['provider-b', 'shared-model']));
    await page.getByRole('status').filter({ hasText: '默认模型已保存' }).waitFor();
    await page.reload();
    await page.getByRole('status').filter({ hasText: '已读取保存的管家默认模型' }).waitFor();
    assert.equal(await selector.inputValue(), JSON.stringify(['provider-b', 'shared-model']));
    dropModelWrite = true;
    await selector.selectOption(JSON.stringify(['provider-a', 'shared-model']));
    await page.getByRole('alert').filter({ hasText: '回读不一致' }).waitFor();
    assert.equal(await selector.inputValue(), JSON.stringify(['provider-b', 'shared-model']));
    dropModelWrite = false; denyModels = true;
    await page.getByRole('button', { name: '重新加载模型' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await selector.inputValue(), ''); denyModels = false;
    checks.push('default model persistence, provider collisions, failed readback and permission failure');

    await page.goto(`${origin}/?templateId=${templateId}&versionId=${versionId}`);
    await page.getByText('历史绑定待更新', { exact: false }).waitFor();
    await page.getByRole('button', { name: '基础信息', exact: true }).click();
    assert.equal(await page.getByText('团队草稿关联', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('combobox', { name: '绑定导师团队' }).count(), 1);
    await page.getByRole('button', { name: '生成当前团队版本' }).click();
    await page.getByText('团队版本已生成并回读确认。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '保存团队绑定', exact: true }).click();
    await page.getByText('团队配置已保存并回读确认，刷新后保留。', { exact: true }).waitFor();
    for (const phase of fixture.template.phases) {
      const member = fixture.team.members.find(entry => entry.assistantId === phase.assignedAssistantId);
      await page.getByRole('combobox', { name: `${phase.title}的导师`, exact: true }).selectOption(member.slotId);
    }
    await page.getByRole('button', { name: '生成教学配置', exact: true }).click();
    await page.getByText('教学配置草稿已生成并保存', { exact: false }).waitFor();
    await page.reload();
    const bundle = page.getByRole('textbox', { name: '教学配置草稿' });
    await page.locator('summary').filter({ hasText: '教学角色与知识范围配置' }).click();
    await page.locator('summary').filter({ hasText: '高级：查看或编辑教学配置 JSON' }).click();
    await bundle.waitFor();
    assert.equal(JSON.parse(await bundle.inputValue()).teamVersionId, fixture.team.id);
    assert.equal(new URL(page.url()).searchParams.get('versionId'), versionId);
    await page.getByRole('button', { name: '校验并启用绑定', exact: true }).click();
    await page.getByText('团队绑定已生效', { exact: false }).waitFor();
    await page.locator('summary').filter({ hasText: '历史项目会话恢复' }).click();
    await page.getByRole('textbox', { name: '项目绑定修复原因' }).fill('Reviewed configuration');
    await page.getByRole('button', { name: '确认恢复此项目', exact: true }).click();
    await page.getByText('已确认并保存该项目的教学绑定', { exact: false }).waitFor();
    await page.reload();
    await page.getByText('教学配置已就绪', { exact: false }).first().waitFor();
    assert.equal(courseWrites, 0);
    denyBindings = true; await page.reload();
    await page.getByRole('alert').filter({ hasText: '绑定目录读取被拒绝' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '保存团队绑定', exact: true }).isDisabled(), true);
    denyBindings = false;
    checks.push('single binding entry, explicit phase members, draft reload, activation, recovery and directory failure');

    Object.assign(template, { status: 'draft', title: 'Editable template', latestPublishedVersionId: null });
    version = { ...version, status: 'draft', content: { phases: [{ id: 'explore', name: 'Explore', gateRule: '', stagePrompt: '', mentorRole: '' }] }, stages: [{ id: 'explore', label: 'Explore' }] };
    await page.goto(`${origin}/?templateId=${templateId}&versionId=${versionId}`);
    await page.getByRole('button', { name: '保存模板与阶段设计', exact: true }).click();
    await page.getByText('基础信息已保存并回读确认', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '保存模板与阶段设计', exact: true }).waitFor();
    assert.equal(courseWrites, 0);
    await page.getByRole('button', { name: '基础信息', exact: true }).click();
    const titleInput = page.locator('.admin-form-row').filter({ hasText: '模板标题' }).locator('input');
    await titleInput.fill('Edited template persists');
    await page.getByRole('button', { name: '保存模板与阶段设计', exact: true }).click();
    await page.getByText('基础信息已保存并回读确认', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '编辑模板：Edited template persists' }).waitFor();
    await page.getByPlaceholder('阶段名称（必填）').fill('Updated exploration phase');
    await page.getByRole('button', { name: '保存模板与阶段设计', exact: true }).click();
    await page.getByText('阶段设计已保存为新版本 v2', { exact: false }).waitFor();
    await page.reload();
    await page.getByPlaceholder('阶段名称（必填）').waitFor();
    assert.equal(await page.getByPlaceholder('阶段名称（必填）').inputValue(), 'Updated exploration phase');
    assert.equal(new URL(page.url()).searchParams.get('versionId'), 'configuration-version-2');
    assert.equal(courseWrites, 1);
    checks.push('metadata edits persist; only changed phase content creates a course version and refresh selects that version');
    assert.deepEqual(errors, []);
    const result = { success: true, checks, modelWrites, courseWrites, productionWrites: false };
    writeFileSync(new URL('../services/api/.tmp/configuration-browser/results.json', import.meta.url), JSON.stringify(result, null, 2));
    return result;
  } finally { page.off('pageerror', onError); await page.unrouteAll({ behavior: 'wait' }); }
}
