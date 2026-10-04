#!/usr/bin/env node
/**
 * 基线检查（替代原先的占位 lint / 假 test 脚本）。
 *
 * 背景：本仓库曾有一批「永远绿」的脚本 —— `lint` 只是 `node -e "console.log('... placeholder')"`，
 * 部分包的 `test` 只是打印 "no tests yet"，`services/api` 的 test glob 还漏掉了 22 个测试文件，
 * 于是 `pnpm test` / `pnpm lint` 全绿但什么也没验证（已归档为 Issue #22）。
 *
 * 本脚本做三件事，且都**真的会失败**：
 *   1. 禁止「只打印不执行」的 test / lint 脚本再次进入仓库；
 *   2. 禁止把 `tsc --noEmit` 当成 test（typecheck 已有独立任务，不能冒充测试）；
 *   3. 禁止提交 focused 测试（`.only`），避免 CI 只跑一个用例。
 *
 * 用法：
 *   node tooling/lint-baseline.mjs               # 检查当前包（由 turbo 逐包调用）
 *   node tooling/lint-baseline.mjs --workspace   # 检查整个工作区 + basePath + 测试覆盖债务
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';

const ARGS = process.argv.slice(2);
const WORKSPACE_MODE = ARGS.includes('--workspace');

/** 只打印、不校验的脚本形态 */
const FAKE_PRINT_RE = /node\s+-e\s+["'`]console\.log\(/;
/** 整脚本就是 `tsc ...`（后面没有真正的测试运行器） */
const TSC_ONLY_RE = /^\s*tsc(\s|$)/;
/** 真正的测试运行器：node / tsx / vitest 的 --test 或 --test 开关 */
const REAL_TEST_RUNNER_RE = /(^|\s)--test(\s|$)|node:test/;

/**
 * `-e` 打印、或「只有 tsc 而没有测试运行器」→ 视为假 test。
 *
 * 注意：`tsc -p tsconfig.test.json && node --test "..."` 是**真**测试
 * （先编译再跑），不能误判。这里必须同时满足「以 tsc 开头」和
 * 「没有 --test」，否则一次误判就会把学生的真实测试删掉（曾发生）。
 */
function isFakeTestScript(script) {
  if (!script) return null;
  if (FAKE_PRINT_RE.test(script)) return '只打印不执行（node -e console.log）';
  if (TSC_ONLY_RE.test(script) && !REAL_TEST_RUNNER_RE.test(script)) {
    return '用 tsc 冒充测试（应交给 typecheck 任务）';
  }
  return null;
}

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function workspacePackageDirs(root) {
  const dirs = [];
  for (const top of ['apps', 'packages', 'services']) {
    const topDir = join(root, top);
    if (!statSync(topDir, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const name of readdirSync(topDir)) {
      const dir = join(topDir, name);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  // database 直接在仓库根下一级
  if (existsSync(join(root, 'database', 'package.json'))) dirs.push(join(root, 'database'));
  return dirs.sort();
}

function readPackageJson(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

function rel(root, target) {
  return relative(root, target).split(sep).join(posix.sep) || '.';
}

function checkScripts(root, dir, violations) {
  const pkg = readPackageJson(dir);
  const scripts = pkg.scripts ?? {};
  const where = rel(root, dir);

  // lint 不允许是占位
  if (scripts.lint && FAKE_PRINT_RE.test(scripts.lint)) {
    violations.push(`${where}: "lint" 是占位脚本（只打印不检查）→ 改为 node ../../tooling/lint-baseline.mjs`);
  }

  const fakeTest = isFakeTestScript(scripts.test);
  if (fakeTest) {
    violations.push(`${where}: "test" ${fakeTest} → 请删除该脚本（turbo 会跳过没有测试的包）`);
  }
}

/** 扫描目录下的 *.test.ts / *.test.tsx 是否含 focused 用例 */
function checkFocusedTests(root, dir, violations) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist' || entry.name === '.tmp') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.test\.(ts|tsx)$/.test(entry.name)) continue;
      const lines = readFileSync(full, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/^\s*(describe|it|test)\.only\s*\(/.test(line)) {
          violations.push(`${rel(root, full)}:${index + 1}: 存在 focused 测试 .only，CI 会只跑这一个用例`);
        }
      });
    }
  }
}

function checkBasePath(root, violations) {
  const script = join(root, 'tooling', 'check-basepath.mjs');
  if (!existsSync(script)) return;
  try {
    execFileSync(process.execPath, [script], { cwd: root, stdio: 'pipe' });
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .map((buffer) => buffer.toString().trim())
      .join('\n');
    violations.push(output || 'basePath 检查未通过（node tooling/check-basepath.mjs）');
  }
}

function main() {
  const root = findRepoRoot(process.cwd());
  if (!root) {
    console.error('✗ 未找到仓库根（缺少 pnpm-workspace.yaml）');
    process.exit(1);
  }

  const violations = [];

  if (WORKSPACE_MODE) {
    const dirs = workspacePackageDirs(root);
    const withoutTests = [];
    for (const dir of dirs) {
      checkScripts(root, dir, violations);
      checkFocusedTests(root, dir, violations);
      const pkg = readPackageJson(dir);
      if (!pkg.scripts?.test) withoutTests.push(rel(root, dir));
    }
    checkBasePath(root, violations);

    if (violations.length > 0) {
      console.error('✗ 基线检查未通过：\n');
      violations.forEach((v) => console.error(`  - ${v}\n`));
      process.exit(1);
    }

    console.log(`✓ 基线检查通过：${dirs.length} 个包，无占位脚本 / 无 focused 测试 / basePath 正常。`);
    if (withoutTests.length > 0) {
      console.log(`\nℹ 尚无测试脚本的包（${withoutTests.length} 个，债务可见但不阻塞）：`);
      console.log(`  ${withoutTests.join(', ')}`);
    }
    return;
  }

  // 包模式：只检查当前包
  checkScripts(root, process.cwd(), violations);
  checkFocusedTests(root, process.cwd(), violations);

  if (violations.length > 0) {
    console.error(`✗ ${rel(root, process.cwd())} 基线检查未通过：\n`);
    violations.forEach((v) => console.error(`  - ${v}\n`));
    process.exit(1);
  }
  console.log(`✓ ${rel(root, process.cwd())}: 基线检查通过`);
}

main();
