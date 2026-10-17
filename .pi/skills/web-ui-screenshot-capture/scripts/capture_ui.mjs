#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const out = { url: null, output: 'AdminUI', routesFile: null, loginPath: '/login', roles: [], maxPages: 200, timeout: 30000, publicFolder: 'home', viewport: '1440x1000' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replaceAll('-', '');
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (key === 'url') out.url = value;
    else if (key === 'output') out.output = value;
    else if (key === 'routesfile') out.routesFile = value;
    else if (key === 'loginpath') out.loginPath = value;
    else if (key === 'roles') out.roles = String(value).split(',').map((v) => v.trim()).filter(Boolean);
    else if (key === 'maxpages') out.maxPages = Number(value);
    else if (key === 'timeout') out.timeout = Number(value);
    else if (key === 'publicfolder') out.publicFolder = value;
    else if (key === 'viewport') out.viewport = value;
    else if (key === 'help') out.help = true;
  }
  return out;
}

function help() {
  console.log(`Usage: node capture_ui.mjs --url http://127.0.0.1:3000 [options]\n\nOptions:\n  --output AdminUI             Screenshot root directory\n  --routes-file routes.txt     Seed routes: folder route [authRole]\n  --roles student,parent       Demo roles to authenticate\n  --login-path /login          Login page path\n  --max-pages 200              Crawl limit per context\n  --viewport 1440x1000         Browser viewport\n  --public-folder home         Folder for unauthed pages\n\nEnvironment:\n  PLAYWRIGHT_NODE_MODULES      Directory containing playwright\n  SCREENSHOT_<ROLE>_EMAIL/PASSWORD  Credential fallback per role\n`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.url) { help(); process.exit(args.help ? 0 : 2); }

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_NODE_MODULES ? path.join(process.env.PLAYWRIGHT_NODE_MODULES, 'playwright') : null,
    'playwright',
    'C:/Users/HK/qtzx-browser/node_modules/playwright',
  ].filter(Boolean);
  const require = createRequire(import.meta.url);
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error('Playwright is unavailable. Install it or set PLAYWRIGHT_NODE_MODULES.');
}

const { chromium } = loadPlaywright();
const base = new URL(args.url);
base.pathname = base.pathname.replace(/\/$/, '');
const outputRoot = path.resolve(args.output);
const [width, height] = String(args.viewport).split('x').map(Number);
const browserCandidates = [
  process.env.PLAYWRIGHT_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const executablePath = browserCandidates.find((file) => file && existsSync(file));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

function urlFor(route) {
  return new URL(route, `${base.origin}${base.pathname ? `${base.pathname}/` : '/'}`).toString();
}

function inferFolder(route, fallback = args.publicFolder) {
  const segment = new URL(route, base).pathname.split('/').filter(Boolean)[0];
  if (!segment) return fallback;
  if (['admin', 'parent', 'student', 'teacher', 'home', 'login'].includes(segment)) return segment;
  return fallback;
}

async function readSeeds() {
  if (args.routesFile) {
    const text = await fs.readFile(args.routesFile, 'utf8');
    return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
      const [folder, route, authRole] = line.split(/\s+/);
      return { folder: folder || args.publicFolder, route: route || '/', authRole: authRole || (folder && args.roles.includes(folder) ? folder : null) };
    });
  }
  const seeds = [
    { folder: args.publicFolder, route: '/' },
    { folder: 'login', route: args.loginPath },
    ...args.roles.map((role) => ({ folder: role, route: `/${role}`, authRole: role })),
  ];
  return seeds;
}

async function settle(page, target) {
  let response = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: args.timeout });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(700);
    }
  }
  if (lastError) return { response, error: String(lastError) };
  try { await page.waitForLoadState('networkidle', { timeout: Math.min(args.timeout, 8000) }); } catch {}
  await page.waitForTimeout(350);
  return { response, error: null };
}

async function loginRole(context, role) {
  const page = await context.newPage();
  const first = await settle(page, urlFor(args.loginPath));
  if (first.error) return page;
  const index = { student: 0, parent: 1, teacher: 2, admin: 3 }[role];
  const demo = page.locator('.login-demo-buttons button');
  if (index !== undefined && await demo.count()) {
    await demo.nth(index).click();
  } else {
    const email = process.env[`SCREENSHOT_${role.toUpperCase()}_EMAIL`];
    const password = process.env[`SCREENSHOT_${role.toUpperCase()}_PASSWORD`];
    if (email && password) {
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
    }
  }
  const submit = page.locator('button.login-submit, button[type="submit"]');
  if (await submit.count()) {
    await submit.first().click();
    try { await page.waitForLoadState('networkidle', { timeout: args.timeout }); } catch {}
    await page.waitForTimeout(500);
  }
  return page;
}

function filename(folder, route) {
  const parsed = new URL(route, base);
  let stem = `${folder}_${parsed.pathname.replace(/^\/+|\/+$/g, '').replaceAll('/', '_') || 'home'}`;
  if (parsed.search) stem += `_${parsed.search.slice(1).replace(/[?&=]/g, '_')}`;
  stem = stem.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || `${folder}_page`;
  if (stem.length > 170) stem = `${stem.slice(0, 130)}_${crypto.createHash('sha1').update(route).digest('hex').slice(0, 10)}`;
  return `${stem}.png`;
}

async function captureContext({ context, initialSeeds, defaultFolder, authRole }) {
  const page = context.pages()[0] || await context.newPage();
  const queue = [...initialSeeds];
  const seen = new Set(queue.map((item) => item.route));
  const results = [];
  while (queue.length && seen.size <= args.maxPages) {
    const item = queue.shift();
    const target = urlFor(item.route);
    const settled = await settle(page, target);
    const folder = item.folder || defaultFolder;
    const dir = path.join(outputRoot, folder);
    await fs.mkdir(dir, { recursive: true });
    const file = filename(folder, item.route);
    const filePath = path.join(dir, file);
    let screenshotError = null;
    try { await page.screenshot({ path: filePath, fullPage: true }); } catch (error) { screenshotError = String(error); }
    const record = { folder, route: item.route, url: target, file: path.relative(outputRoot, filePath), title: await page.title().catch(() => ''), status: settled.response?.status() ?? null, error: settled.error || screenshotError, authRole: authRole || null, capturedAt: new Date().toISOString() };
    results.push(record);
    if (settled.error) continue;
    const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((a) => a.href)).catch(() => []);
    for (const href of links) {
      try {
        const next = new URL(href);
        if (next.origin !== base.origin) continue;
        const route = `${next.pathname}${next.search}`;
        if (!seen.has(route) && seen.size < args.maxPages) {
          seen.add(route);
          queue.push({ folder: inferFolder(route, folder), route });
        }
      } catch {}
    }
  }
  return results;
}

const seeds = await readSeeds();
await fs.mkdir(outputRoot, { recursive: true });
const contexts = new Map();
contexts.set('public', await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' }));
for (const role of args.roles) contexts.set(role, await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' }));
const pages = [];
const publicSeeds = seeds.filter((seed) => !seed.authRole);
pages.push(...await captureContext({ context: contexts.get('public'), initialSeeds: publicSeeds.length ? publicSeeds : [{ folder: args.publicFolder, route: '/' }], defaultFolder: args.publicFolder }));
for (const role of args.roles) {
  const page = await loginRole(contexts.get(role), role);
  const roleSeeds = seeds.filter((seed) => seed.authRole === role || seed.folder === role);
  pages.push(...await captureContext({ context: contexts.get(role), initialSeeds: roleSeeds.length ? roleSeeds : [{ folder: role, route: `/${role}` }], defaultFolder: role, authRole: role }));
  await page.close().catch(() => {});
}
await fs.writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify({ baseUrl: args.url, generatedAt: new Date().toISOString(), screenshotCount: pages.filter((page) => !page.error).length, pages }, null, 2));
for (const context of contexts.values()) await context.close();
await browser.close();
console.log(`Captured ${pages.filter((page) => !page.error).length}/${pages.length} pages into ${outputRoot}`);
