// Browser regression: set QITU_VERIFY_ORIGIN; optionally QITU_PLAYWRIGHT_MODULE and QITU_CHROME_PATH.
// Uses the existing administrator test login; intercepts all platform-config writes.
const { chromium } = require(process.env.QITU_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const origin = process.env.QITU_VERIFY_ORIGIN || 'http://127.0.0.1:13584';
const stage = process.env.QITU_VERIFY_STAGE || 'candidate';
(async () => {
  const browser = await chromium.launch({
    ...(process.env.QITU_CHROME_PATH ? { executablePath: process.env.QITU_CHROME_PATH } : {}),
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [],
    checks = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let writes = 0,
    release,
    hold = false,
    failNext = false;
  try {
    await page.goto(origin + '/login');
    await page.waitForFunction(() => {
      const el = document.querySelector('#login-email');
      return el && Object.keys(el).some((k) => k.startsWith('__reactProps'));
    });
    await page.getByRole('button', { name: '管理员账号', exact: true }).click();
    await page.getByRole('button', { name: '进入系统', exact: true }).click();
    await page.waitForURL(/\/admin/);
    const baseline = (
      await (await context.request.get(origin + '/api/v1/admin/platform-config')).json()
    ).data;
    const runtime = (await (await context.request.get(origin + '/api/v1/admin/ai-runtime')).json())
      .data;
    const label = runtime.mcpServers.find((server) => server.id === 'ima-knowledge').label;
    let state = structuredClone(baseline);
    // All writes are intercepted; real server authorization and credentials remain unchanged.
    await page.route('**/api/v1/admin/platform-config', async (route) => {
      const request = route.request();
      if (request.method() === 'PUT') {
        writes++;
        const input = request.postDataJSON();
        if (hold) {
          hold = false;
          await new Promise((resolve) => {
            release = resolve;
          });
        }
        if (failNext) {
          failNext = false;
          return route.fulfill({
            status: 500,
            json: { code: 'TEST_SAVE_FAILED', message: '模拟保存失败，请重试' },
          });
        }
        assert.equal(
          input.expectedRevision,
          state.revision,
          'queued writes must use successive revisions',
        );
        state = { revision: state.revision + 1, config: input.config };
      }
      return route.fulfill({ status: 200, json: { data: state } });
    });
    const boxes = page.getByRole('checkbox', {
      name: new RegExp(' 是否授权 ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
    });
    const loaded = async () => {
      await boxes.nth(2).waitFor();
      await page.waitForFunction(
        (label) =>
          Array.from(document.querySelectorAll('[role="checkbox"]')).some(
            (el) =>
              el.getAttribute('aria-label')?.endsWith('是否授权 ' + label) &&
              el.getAttribute('aria-disabled') === 'false',
          ),
        label,
      );
    };
    const values = async () =>
      Promise.all([0, 1, 2].map((i) => boxes.nth(i).getAttribute('aria-checked')));
    const idle = () =>
      page.waitForFunction(() => !document.body.textContent.includes('正在保存知识库检索授权'));
    await page.goto(origin + '/admin/settings/tools');
    await loaded();
    const initial = await values();
    await boxes.first().evaluate((el) => {
      window.__matrixFirst = el;
    });
    hold = true;
    await boxes.nth(0).click();
    await boxes.nth(1).click();
    await boxes.nth(2).click();
    await boxes.nth(0).click();
    const expected = [initial[0], String(initial[1] !== 'true'), String(initial[2] !== 'true')];
    assert.deepEqual(await values(), expected);
    assert.equal(await boxes.first().getAttribute('aria-disabled'), 'false');
    assert.equal(await boxes.first().evaluate((el) => el === window.__matrixFirst), true);
    assert.equal(
      await page.getByText('正在读取 AI 运行时目录与助手列表…', { exact: true }).count(),
      0,
    );
    assert.ok(release, 'first save should be held while subsequent clicks remain usable');
    release();
    await idle();
    assert.equal(writes, 4);
    assert.deepEqual(await values(), expected);
    checks.push('rapid multi-row and repeated same-row clicks remain interactive and optimistic');
    checks.push(
      'four writes serialize with successive revisions; older replies preserve later clicks',
    );
    await page.reload();
    await loaded();
    assert.deepEqual(await values(), expected);
    checks.push('saved authorization survives a page reload');
    hold = true;
    failNext = true;
    release = undefined;
    await boxes.nth(0).click();
    await boxes.nth(1).click();
    assert.ok(release);
    release();
    await idle();
    await page.getByText('知识库检索：模拟保存失败，请重试', { exact: false }).waitFor();
    const afterFailure = [expected[0], String(expected[1] !== 'true'), expected[2]];
    assert.deepEqual(await values(), afterFailure);
    assert.equal(writes, 6);
    checks.push(
      'failed save rolls back only its change; later queued selection still persists with a visible error',
    );
    await page.reload();
    await loaded();
    assert.deepEqual(await values(), afterFailure);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
    assert.deepEqual(errors, []);
    const unchanged = (
      await (await context.request.get(origin + '/api/v1/admin/platform-config')).json()
    ).data;
    assert.equal(
      JSON.stringify(unchanged) === JSON.stringify(baseline),
      true,
      'real configuration must remain unchanged',
    );
    checks.push(
      'mobile/desktop have no page overflow, no JavaScript errors, real server settings unchanged',
    );
    const out = 'matrix-continuous-verification/' + stage;
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      out + '/report.json',
      JSON.stringify({ status: 'PASS', stage, checks }, null, 2),
    );
    console.log(JSON.stringify({ status: 'PASS', stage, checks: checks.length }));
  } finally {
    await context.request.post(origin + '/api/v1/auth/logout').catch(() => {});
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
