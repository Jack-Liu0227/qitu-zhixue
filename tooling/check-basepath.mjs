#!/usr/bin/env node
/**
 * basePath 前缀重复检查。
 *
 * 背景：四个应用都用了 Next.js 的 `basePath`（/student、/teacher、/parent、/admin）。
 * Next 会给下列 API **自动补** basePath：
 *
 *   - `next/navigation` 的 `redirect()`  → 客户端 `addBasePath()`
 *   - `useRouter().push()/replace()`     → `addBasePath()`
 *   - `next/link` 的 `href`              → `addBasePath()`
 *
 * 而 `addBasePath()` 底层是 `addPathPrefix()`，**只拼前缀、不去重**：
 *
 *   addPathPrefix('/teacher/students', '/teacher') === '/teacher/teacher/students'
 *
 * 所以在这三处再写一遍自己的 basePath 就会 404。历史事故：
 * `apps/teacher-workspace/app/(workspace)/students/[id]/page.tsx` 曾写成
 * `redirect('/teacher/students?...')`，实际落到 `/teacher/teacher/students`。
 *
 * 正确写法：传 basePath **相对**路径（`/students`、`/today`、`/settings/models`），
 * 参见 `apps/student-center/app/page.tsx`。
 *
 * 例外：如果某个封装组件会主动「剥掉」basePath 再交给 `next/link`
 * （例如 student-center 的 `StudentLink` / `BreadcrumbLink`），那么使用它的地方
 * 继续写完整 `/student/...` 是**正确的**，本脚本会跳过这些行。
 *
 * 需要额外豁免时：在该行加 `basepath-ok` 注释。
 *
 * 用法：node tooling/check-basepath.mjs   （CI 的 structure job 已接入）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

const ROOT = process.cwd();
const APPS_DIR = join(ROOT, 'apps');

const SCAN_DIRS = ['app', 'components', 'features', 'lib', 'hooks'];

/**
 * 会主动剥离 basePath 的封装组件：使用它们的地方写完整 basePath 是正确的。
 * 键为 apps/<name> 下的相对路径（posix 风格），值为该文件导出的组件名。
 */
const NORMALIZING_COMPONENTS = {
  'student-center/components/student-link.tsx': ['StudentLink', 'toAppHref'],
  'student-center/components/breadcrumb-link.tsx': ['BreadcrumbLink'],
};

const MARKER = 'basepath-ok';

function appRelative(file) {
  return relative(APPS_DIR, file).split(sep).join(posix.sep);
}

function readBasePath(appName) {
  const configPath = join(APPS_DIR, appName, 'next.config.ts');
  let source;
  try {
    source = readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }
  const match = source.match(/basePath:\s*['"`]([^'"`]+)['"`]/);
  return match ? match[1].replace(/^\//, '') : null;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** basePath 前缀之后允许出现的字符 */
const TAIL = "(?:[/'\"`)?#\\s,]|$)";
/** `<Link` 但不匹配 `<StudentLink` */
const PLAIN_LINK_RE = /(?<![A-Za-z0-9_.])<Link\b/;

function main() {
  if (!statSync(APPS_DIR, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`✗ 未找到 apps 目录：${APPS_DIR}`);
    process.exit(1);
  }

  // 收集全部「会归一化 basePath 的封装组件名」，它们出现的行跳过 href 规则
  const normalizingNames = new Set();
  for (const [rel, names] of Object.entries(NORMALIZING_COMPONENTS)) {
    if (statSync(join(APPS_DIR, rel), { throwIfNoEntry: false })) {
      names.forEach((n) => normalizingNames.add(n));
    }
  }

  const appNames = readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const violations = [];
  let scannedApps = 0;
  let scannedFiles = 0;

  for (const appName of appNames) {
    const basePath = readBasePath(appName);
    if (!basePath) continue; // 无 basePath 的应用不受影响
    scannedApps += 1;

    const bp = escapeRe(basePath);
    const redirectRe = new RegExp(`\\bredirect\\s*\\(\\s*[\`'"\\/]\\/${bp}${TAIL}`);
    const routerRe = new RegExp(`\\brouter\\.(?:push|replace)\\s*\\(\\s*[\`'"]\\/${bp}${TAIL}`);
    const hrefRe = new RegExp(`\\bhref\\s*=\\s*\\{?\\s*[\`'"]\\/${bp}${TAIL}`);

    for (const scanDir of SCAN_DIRS) {
      for (const file of walk(join(APPS_DIR, appName, scanDir))) {
        const relFromApps = appRelative(file);
        scannedFiles += 1;

        const isNormalizerItself = Object.hasOwn(NORMALIZING_COMPONENTS, relFromApps);

        for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
          if (line.includes(MARKER)) continue;
          // 归一化组件自身（实现剥离逻辑）不检查 href
          if (isNormalizerItself) continue;

          let kind = null;
          if (redirectRe.test(line)) kind = 'redirect()';
          else if (routerRe.test(line)) kind = 'useRouter().push()/replace()';
          else if (hrefRe.test(line)) {
            // 只有原生 next/link 才会自动补 basePath。
            // 使用归一化封装组件（StudentLink 等）时，写完整 basePath 是对的。
            const usesNormalizer = [...normalizingNames].some((name) =>
              new RegExp(`(?<![A-Za-z0-9_.])<${name}\\b`).test(line),
            );
            if (!usesNormalizer && PLAIN_LINK_RE.test(line)) kind = 'next/link href';
          }
          if (!kind) continue;

          violations.push({ file: relFromApps, line: index + 1, kind, basePath, text: line.trim() });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('✗ basePath 前缀重复：Next 会自动补 basePath，这里再写一遍会 404。\n');
    for (const v of violations) {
      console.error(`  apps/${v.file}:${v.line}`);
      console.error(`    类型: ${v.kind}   basePath: /${v.basePath}`);
      console.error(`    内容: ${v.text}`);
      console.error(`    修法: 改成 basePath 相对路径（去掉 /${v.basePath} 前缀）`);
      console.error(`          若确为有意为之，在该行加 ${MARKER} 注释\n`);
    }
    console.error(`共 ${violations.length} 处，扫描 ${scannedApps} 个带 basePath 的应用。`);
    process.exit(1);
  }

  console.log(`✓ basePath 检查通过：${scannedApps} 个应用 / ${scannedFiles} 个文件，无前缀重复。`);
}

main();
