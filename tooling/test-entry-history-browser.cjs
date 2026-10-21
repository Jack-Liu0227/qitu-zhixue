const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3206';
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(require('node:os').tmpdir(), 'qitu-entry-history-browser');
assert.equal(new URL(TARGET_URL).hostname, '127.0.0.1');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [], writes = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  const team = { teamId: 'published-team', teamName: '合成探究团队', assistantId: 'published-mentor', assistantName: '合成导师' };
  const context = id => ({ project: null, team: id === 'recommended' ? team : { teamId: null, teamName: null, assistantId: 'qitu-intake-assistant', assistantName: '启途智学助手' },
    exploration: { id, templateVersionId: id === 'recommended' ? 'chosen-template' : null, title: id === 'recommended' ? '合成课程挑战' : '自由探索', handoff: id === 'recommended' ? 'ready' : 'free' },
    progress: { currentStageIndex: 0, stageTotal: 10, progressPercent: 0 }, stages: [], currentTask: null, phases: [] });
  const turn = (id, text) => ({ turnId: id, role: 'assistant', seq: 1, createdAt: '2026-10-21T00:00:00Z', hintLevel: 1,
    stageBefore: 'exploration', stageAfter: 'exploration', author: { id: 'published-mentor', name: '合成导师', role: 'leader' },
    blocks: [{ kind: 'text', text }, { kind: 'options', allowOther: true, items: [{ label: '从生活现象开始', text: '请用生活现象帮助我探索。' }] }] });
  const session = id => ({ sessionId: `session-${id}`, explorationId: id, projectId: null, source: 'exploration', lastSeq: 1,
    context: { kind: 'exploration', label: '探索', status: 'active', projectId: null },
    turns: [turn(id, id === 'recommended' ? '合成导师陪你从「合成课程挑战」开始。确认后才创建项目。' : '你好，你的探索搭档在这里。最近有什么让你好奇的现象？')] });
  const items = Array.from({ length: 18 }, (_, i) => ({ id: `project-${i}`, kind: 'project', title: `合成探究项目 ${i + 1}`, subtitle: '独立确认的历史项目', tags: [], status: 'intent_confirmed',
    currentStageIndex: 1, stageTotal: 10, progressPercent: 10, templateVersionId: 'chosen-template', createdAt: '2026-10-20T00:00:00Z',
    lastLearningActivityAt: null, collectedAt: null, isCurrent: i === 0 }));
  let collected = false;
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname;
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) });
    if (request.method() !== 'GET') writes.push({ p, body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
    if (p === '/api/v1/explorations') return send({ id: request.postDataJSON().source === 'recommended' ? 'recommended' : 'free' });
    if (p === '/api/v1/tutor/project-context') {
      if (url.searchParams.has('projectId')) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'PROJECT_BINDING_RECONFIRM_REQUIRED', message: '合成历史配置需要恢复' }) });
      return send(context(url.searchParams.get('explorationId') || 'free'));
    }
    if (p === '/api/v1/tutor/session') return send(session(url.searchParams.get('explorationId') || 'free'));
    if (p === '/api/v1/tutor/project-history') return send({ ...session('old'), projectId: 'legacy', turns: [turn('old', '合成旧会话记录：我的已有观察。')] });
    if (p.includes('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    if (p === '/api/v1/tutor/session-counts') return send({});
    if (p === '/api/v1/projects/query') {
      if (page.url().includes('/tutor')) return send({ items: [], nextCursor: null });
      const list = collected && url.searchParams.get('includeCollected') !== 'true' ? items.slice(1) : items;
      const start = url.searchParams.has('cursor') ? 12 : 0;
      return send({ items: list.slice(start, start + 12), nextCursor: start ? null : 'page-two', counts: { active: 18, draft: 0, done: 0 }, revision: 'synthetic', preferenceVersion: collected ? 1 : 0, currentProjectId: null, selectionSource: 'none' });
    }
    if (p.endsWith('/display-preference')) {
      collected = true;
      return send({ superseded: false, replayed: false, version: 1, currentVersion: 1, currentProjectId: null, collectedAt: '2026-10-21T00:00:00Z' });
    }
    if (p.includes('/bindings') || p.includes('/project-recovery')) return send([]);
    return send(null);
  });
  try {
    await page.goto(TARGET_URL + '/student/inspiration');
    assert.equal(await page.getByRole('link', { name: '开始自由探索' }).getAttribute('href'), '/student/tutor?new=1');
    await page.getByRole('link', { name: '开始自由探索' }).click();
    await page.getByText('你好，你的探索搭档在这里。最近有什么让你好奇的现象？').waitFor();
    await page.getByRole('button', { name: /从生活现象开始/ }).waitFor();
    assert.equal(writes.filter(x => x.p === '/api/v1/explorations').length, 1);
    await page.reload();
    await page.getByText('你好，你的探索搭档在这里。最近有什么让你好奇的现象？').waitFor();
    assert.equal(writes.filter(x => x.p === '/api/v1/explorations').length, 1, 'reload must resume the owned exploration');
    checks.push('free entry, welcome, choices and refresh without another exploration');

    await page.goto(TARGET_URL + '/student/inspiration');
    await page.getByRole('button', { name: '💬 与AI搭档开始', exact: true }).click();
    await page.getByText('合成导师陪你从「合成课程挑战」开始。确认后才创建项目。').waitFor();
    await page.getByText('已由专属导师团队【合成探究团队】接管辅导；当前发言助手为合成导师。', { exact: true }).waitFor();
    assert.ok(writes.some(x => x.body?.templateVersionId === 'chosen-template' && x.key));
    assert.equal(writes.some(x => x.p.includes('confirm-intent') || x.p.includes('confirm-plan')), false);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'recommended.png'), fullPage: true });
    checks.push('template entry, exact context/mentor and no formal project creation');

    await page.goto(TARGET_URL + '/student/tutor/legacy');
    await page.getByText('这个项目的导师配置需要更新').waitFor();
    await page.getByRole('button', { name: '查看已有对话（只读）' }).click();
    await page.getByText('合成旧会话记录：我的已有观察。').waitFor();
    assert.equal(await page.getByRole('button', { name: /从生活现象开始/ }).isDisabled(), true);
    checks.push('legacy blockade preserves read-only history and disables actions');

    await page.goto(TARGET_URL + '/student/projects');
    await page.getByText('合成探究项目 12', { exact: true }).waitFor();
    assert.equal(await page.locator('.qitu-project-card').count(), 12);
    assert.equal(await page.locator('.qitu-project-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.getByText('合成探究项目 18', { exact: true }).waitFor();
    assert.equal(await page.locator('.qitu-project-card').count(), 6);
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await page.getByText('合成探究项目 1', { exact: true }).waitFor();
    await page.getByRole('button', { name: '收纳并清空当前选择', exact: true }).click();
    await page.getByText('显示偏好已保存。', { exact: true }).waitFor();
    assert.equal(await page.getByText('合成探究项目 1', { exact: true }).count(), 0);
    await page.getByRole('checkbox', { name: '包含已收纳' }).check();
    await page.getByText('合成探究项目 1', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'projects-desktop.png'), fullPage: true });
    checks.push('bounded list, real cursor navigation and receipt-confirmed collection');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.qitu-project-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'projects-mobile.png'), fullPage: true });
    checks.push('mobile single column without page overflow');

    await page.goto(TARGET_URL + '/admin');
    await page.getByLabel('教学配置操作指南').waitFor();
    await page.getByText('教学角色与知识范围配置', { exact: true }).click();
    await page.getByText('尚未生成教学配置。完成团队版本与绑定后，选择课时和各阶段导师即可生成。', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('教学配置草稿').count(), 0);
    checks.push('Admin guide replaces an unusable blank JSON editor');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'verification.json'), JSON.stringify({ success: true, scope: 'actual source components with isolated API fixtures; no live model/classroom claim', checks }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks, output: OUTPUT_DIR }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
