#!/usr/bin/env node
/**
 * T1 静态校验：四端页面转场与「减弱动效」基线。
 *
 * 这是一个纯静态、确定性的守卫脚本：不启动浏览器、不依赖网络，只读取设计系统
 * 与四端的 CSS / 外壳源码，断言以下不变量仍然成立——
 *
 *   1. `@qitu/ui` 提供 `prefers-reduced-motion: reduce` 兜底；
 *   2. 四端共用一个 `qitu-page-in` 短转场，且转场不设置 `pointer-events`
 *      （因此不会阻塞交互）；
 *   3. spinner 在减弱动效下有一个「不卡死」的静态形态（完整圆环 + 圆心点）；
 *   4. 四个客户端各自带有 `prefers-reduced-motion` 覆盖；
 *   5. 四个客户端都接入了统一页面转场。
 *
 * 由 `packages/ui` 的 `test` 脚本调用，随 `pnpm test` / CI 一起运行。
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const UI_STYLES = 'packages/ui/src/styles.css';
const UI_SHELL = 'packages/ui/src/shell.tsx';

const CLIENTS = {
  'student-center': 'apps/student-center',
  'parent-companion': 'apps/parent-companion',
  'teacher-workspace': 'apps/teacher-workspace',
  'admin-console': 'apps/admin-console',
};

/** 每个客户端的转场接入点：文件 + 必须出现的关键令牌。 */
const TRANSITION_SOURCES = {
  'student-center': [UI_SHELL, 'qitu-page-transition'],
  'parent-companion': ['apps/parent-companion/features/ParentShell.tsx', 'qitu-page-transition'],
  'teacher-workspace': ['apps/teacher-workspace/app/globals.css', 'qitu-page-in'],
  'admin-console': ['apps/admin-console/app/(console)/layout.tsx', 'qitu-page-transition'],
};

const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const failures = [];
let passed = 0;

function check(name, run) {
  try {
    run();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failures.push(`${name}\n        ${error.message}`);
    console.error(`  FAIL - ${name}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** 递归收集目录下的 `.css` 文件（跳过依赖与构建产物）。 */
function cssFilesUnder(relativeDir) {
  const skip = new Set(['node_modules', '.next', 'dist']);
  const found = [];
  const walk = (absoluteDir) => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) {
          walk(path.join(absoluteDir, entry.name));
        }
      } else if (entry.name.endsWith('.css')) {
        found.push(path.join(absoluteDir, entry.name));
      }
    }
  };
  walk(path.join(ROOT, relativeDir));
  return found;
}

console.log('reduced-motion guard (T1)');

check('@qitu/ui 提供 prefers-reduced-motion 兜底', () => {
  const css = read(UI_STYLES);
  assert(css.includes(REDUCED_MOTION), `${UI_STYLES} 缺少 ${REDUCED_MOTION}`);
});

check('@qitu/ui 定义统一的页面转场', () => {
  const css = read(UI_STYLES);
  assert(css.includes('@keyframes qitu-page-in'), '缺少 qitu-page-in 关键帧');
  assert(css.includes('.qitu-page-transition'), '缺少 .qitu-page-transition 类');

  const ruleMatch = /\.qitu-page-transition\s*\{([^}]*)\}/.exec(css);
  assert(ruleMatch, '未找到 .qitu-page-transition 规则体');
  assert(
    !ruleMatch[1].includes('pointer-events'),
    '.qitu-page-transition 不应设置 pointer-events（必须保持可交互）',
  );
});

check('spinner 在减弱动效下有静态且不卡死的形态', () => {
  const css = read(UI_STYLES);
  const block = css.slice(css.indexOf(REDUCED_MOTION));
  assert(block.includes('.qitu-spinner-circle'), '减弱动效块未覆盖 .qitu-spinner-circle');
  assert(
    block.includes('border-color: currentColor'),
    '减弱动效下 spinner 应补全边框，避免留下缺口像卡死',
  );
});

for (const [client, dir] of Object.entries(CLIENTS)) {
  check(`${client} 自带 prefers-reduced-motion 覆盖`, () => {
    const hit = cssFilesUnder(dir).some((file) => readFileSync(file, 'utf8').includes(REDUCED_MOTION));
    assert(hit, `${dir} 下的 CSS 未出现 ${REDUCED_MOTION}`);
  });
}

for (const [client, [file, token]] of Object.entries(TRANSITION_SOURCES)) {
  check(`${client} 接入统一页面转场`, () => {
    assert(read(file).includes(token), `${file} 未包含 ${token}`);
  });
}

if (failures.length > 0) {
  console.error(`\nreduced-motion guard: ${failures.length} 项失败\n`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`\nreduced-motion guard: ${passed} 项通过`);
