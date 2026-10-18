// Local UI + explicitly selected read-only API. Never save cookies or response bodies.
const { chromium } = require(process.env.QITU_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loginOrigin = process.env.QITU_VISUAL_LOGIN_ORIGIN;
if (!loginOrigin) throw new Error('Set QITU_VISUAL_LOGIN_ORIGIN to a test-account login portal.');
const origins = JSON.parse(process.env.QITU_VISUAL_ORIGINS || JSON.stringify({
  student: 'http://127.0.0.1:3201', parent: 'http://127.0.0.1:3202',
  teacher: 'http://127.0.0.1:3203', admin: 'http://127.0.0.1:3204',
}));
const output = process.env.QITU_VISUAL_OUTPUT;
if (!output) throw new Error('Set QITU_VISUAL_OUTPUT to a local temporary screenshot directory.');
const specs = {
  student: ['学生账号', ['', 'today', 'inspiration', 'tutor', 'projects', 'works', 'growth', 'profile']],
  parent: ['家长账号', ['', 'progress', 'messages']],
  teacher: ['班主任账号', ['', 'dashboard', 'students', 'issues', 'statistics', 'knowledge']],
  admin: ['管理员账号', ['', 'students', 'students/statistics', 'teachers', 'relationships', 'copilot', 'models', 'settings',
    ...['account', 'model-providers', 'assistants', 'skills', 'teams', 'templates', 'knowledge', 'tools',
      'ai-runtime', 'profile-growth', 'appearance', 'dialogs', 'plugins', 'feishu', 'database', 'ops',
      'system', 'about', 'models'].map((part) => `settings/${part}`)]],
};
const selectedRoles = (process.env.QITU_VISUAL_ROLES || Object.keys(specs).join(',')).split(',');
const widths = (process.env.QITU_VISUAL_WIDTHS || '1440,768,390').split(',').map(Number);

function representativeRoute(role, href) {
  const url = new URL(href, origins[role]);
  if (url.origin !== origins[role]) return null;
  const route = url.pathname.replace(new RegExp(`^/${role}/?`), '');
  const pattern = {
    student: /^(inspiration\/recommended|projects|tutor)\/[^/]+(?:\/(theory|practice|reflection|workbench))?$/,
    teacher: /^(students|issues)\/[^/]+$/,
    admin: /^(students|teachers)\/[^/]+$/,
  }[role];
  if (!pattern?.test(route) || route === 'students/statistics') return null;
  const mode = url.searchParams.get('mode');
  return { route: route + (mode ? `?mode=${encodeURIComponent(mode)}` : ''),
    key: route.replace(/^(inspiration\/recommended|projects|tutor|students|teachers|issues)\/[^/]+/, '$1/:id') + (mode || '') };
}

function geometry() {
  const rect = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width),
      height: Math.round(box.height), bottom: Math.round(box.bottom) };
  };
  return {
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    title: rect('h1'), tutorTitle: rect('.qitu-tutor-title-row h1'),
    composer: rect('.qitu-composer'), thread: rect('.qitu-chat-thread'),
    settings: rect('.settings-main'), feedback: rect('.parent-feedback'),
    brokenImages: [...document.images].filter((img) => img.complete && !img.naturalWidth).length,
    headings: [...document.querySelectorAll('h1,h2,h3')].filter((el) => {
      const r = el.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
      return r.width > 0 && r.width < 65 && r.height > lineHeight * 2.1 && el.textContent.length >= 6;
    }).map((el) => ({ className: el.className, width: el.clientWidth, height: el.clientHeight })),
  };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = process.env.QITU_VISUAL_CDP
    ? await chromium.connectOverCDP(process.env.QITU_VISUAL_CDP)
    : await chromium.launch({ headless: false });
  const report = [];
  const failures = [];
  let blockedWrites = 0;
  let forwardingFailures = 0;
  let cancelledForwardings = 0;
  try {
    for (const [role, [label, routes]] of Object.entries(specs)) {
      if (!selectedRoles.includes(role)) continue;
      const discovered = new Set();
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      let contextClosing = false;
      await page.goto(`${loginOrigin}/login`);
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('button', { name: '进入系统', exact: true }).click();
      await page.waitForURL(new RegExp(`/${role}(/|$)`));
      const local = new URL(origins[role]);
      await context.addCookies((await context.cookies(loginOrigin)).map((cookie) => ({
        ...cookie, domain: local.hostname, secure: local.protocol === 'https:',
      })));
      await context.route('**/api/**', async (route) => {
        const req = route.request();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
          blockedWrites++;
          return route.fulfill({ status: 409, json: { code: 'VISUAL_AUDIT_READ_ONLY', message: '视觉审查不执行写入。' } });
        }
        const url = new URL(req.url());
        try {
          const response = await route.fetch({ url: `${loginOrigin}${url.pathname}${url.search}` });
          return await route.fulfill({ response });
        } catch (error) {
          const cancelled = contextClosing || page.isClosed() || req.failure()
            || /Target.*closed|cancelled|aborted/i.test(error.message);
          if (cancelled) cancelledForwardings++;
          else forwardingFailures++;
          await route.abort().catch(() => {});
        }
      });

      for (const route of routes) {
        const url = `${origins[role]}/${role}${route ? `/${route}` : ''}`;
        try {
          const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
          assert.ok(response && response.status() < 400, 'UI route must load successfully');
          await page.waitForTimeout(250);
          assert.ok(!page.url().includes('/login'), 'Authenticated route must not fall back to login');
          for (const href of await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.href))) {
            const candidate = representativeRoute(role, href);
            if (candidate && !discovered.has(candidate.key)) {
              discovered.add(candidate.key);
              routes.push(candidate.route);
            }
          }
          for (const width of widths) {
            await page.setViewportSize({ width, height: width === 1440 ? 960 : 844 });
            await page.waitForTimeout(100);
            const metrics = await page.evaluate(geometry);
            const name = `${role}-${(route || 'home').replace(/[^\w-]/g, '-')}-${width}`;
            await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
            const record = { role, route, width, ...metrics };
            report.push(record);
            assert.ok(metrics.scrollWidth <= width + 1, `${name}: page overflows horizontally`);
            assert.equal(metrics.headings.length, 0, `${name}: heading squeezed into a narrow column`);
            assert.equal(metrics.brokenImages, 0, `${name}: image failed to load`);
            if (metrics.tutorTitle) {
              assert.ok(metrics.tutorTitle.height < 60, `${name}: tutor title is vertical`);
              assert.ok(metrics.composer?.bottom <= (width === 1440 ? 960 : 844) + 1, `${name}: composer below viewport`);
              assert.ok(metrics.thread?.height >= 90, `${name}: chat has no readable space`);
            }
            if (role === 'admin' && route.startsWith('settings') && width === 390) {
              assert.ok(metrics.settings?.width >= 360, `${name}: settings sidebar squeezes content`);
            }
            if (role === 'parent') assert.equal(metrics.feedback, null, 'Closed feedback must not obscure content');
            if (role === 'admin') {
              const scrolled = await page.evaluate(() => {
                let changed = false;
                for (const el of document.querySelectorAll('.admin-console-content,.settings-main')) {
                  if (el.scrollHeight > el.clientHeight + 5) { el.scrollTop = el.scrollHeight; changed = true; }
                }
                return changed;
              });
              if (scrolled) {
                await page.screenshot({ path: path.join(output, `${name}-bottom.png`), fullPage: true });
                await page.evaluate(() => document.querySelectorAll('.admin-console-content,.settings-main').forEach((el) => { el.scrollTop = 0; }));
              }
            }
          }
          console.log('PASS', role, route || 'home');
        } catch (error) {
          failures.push({ role, route, message: error.message });
          console.error('FAIL', role, route || 'home', error.message);
        }
      }
      if (role === 'parent') {
        await page.getByRole('button', { name: '联系班主任', exact: true }).click();
        await page.getByRole('dialog', { name: '联系班主任与意见反馈' }).waitFor();
        await page.getByRole('button', { name: '收起反馈窗口' }).click();
        assert.equal(await page.getByRole('dialog').count(), 0);
      }
      contextClosing = true;
      await context.unrouteAll({ behavior: 'wait' });
      await context.close();
    }
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ report, failures, blockedWrites, forwardingFailures, cancelledForwardings }, null, 2));
    await browser.close();
  }
  console.log(`${report.length} viewport checks; ${failures.length} failing routes; ${blockedWrites} writes blocked; ${forwardingFailures} forwarding failures.`);
  if (failures.length || forwardingFailures) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
