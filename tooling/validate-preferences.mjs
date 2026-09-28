#!/usr/bin/env node
/**
 * T4 静态校验：基础偏好契约 / 设计令牌 / 服务端允许值三者一致，且主题只引用既有令牌。
 *
 * 纯静态、确定性、不依赖网络：读取契约、设计令牌与服务端允许值源码，断言——
 *
 *   1. 字号 / 主题的允许集合在 contracts、design-tokens、api 三处完全一致；
 *   2. 每个主题预设的每一项都引用既有 `colors` / `semanticColors` 令牌，
 *      不出现任何新的字面色值（`#hex`）——对应验收项「主题只能取既有设计令牌」；
 *   3. 契约里声明了 `PREFERENCE_INVALID` / `PREFERENCE_UNAVAILABLE` 错误码。
 *
 * 由 `packages/design-tokens` 的 `test` 脚本调用，随 `pnpm test` / CI 运行。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const CONTRACTS = 'packages/contracts/src/preferences.ts';
const TOKENS = 'packages/design-tokens/src/index.ts';
const API_VALUES = 'services/api/src/modules/account/account-preferences.values.ts';
const ERRORS = 'packages/contracts/src/errors.ts';

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

/** 从 `NAME = [ 'a', "b" ]` 形式的数组字面量里取出字符串集合。 */
function stringArray(source, name) {
  const match = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
  assert(match, `未找到数组字面量 ${name}`);
  return match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter((entry) => entry.length > 0);
}

/** 取 `export const NAME = { ... } as const;` 块体（按大括号配对截取）。 */
function objectBlock(source, name) {
  const start = source.indexOf(`export const ${name} = {`);
  assert(start >= 0, `未找到对象 ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, i);
    }
  }
  throw new Error(`对象 ${name} 大括号不配对`);
}

/** 取对象块里第一层的键名。 */
function topLevelKeys(block) {
  const keys = [];
  let depth = 0;
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (depth === 0) {
      const keyMatch = /^([A-Za-z0-9_-]+)\s*:/.exec(trimmed);
      if (keyMatch) keys.push(keyMatch[1]);
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return keys;
}

function sameSet(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((value) => setB.has(value));
}

const contracts = read(CONTRACTS);
const tokens = read(TOKENS);
const apiValues = read(API_VALUES);
const errors = read(ERRORS);

const contractThemes = stringArray(contracts, 'PREFERENCE_THEMES');
const contractFontSizes = stringArray(contracts, 'PREFERENCE_FONT_SIZES');

const themeBlock = objectBlock(tokens, 'preferenceThemes');
const fontSizeBlock = objectBlock(tokens, 'preferenceFontSizes');
const tokenThemes = topLevelKeys(themeBlock);
const tokenFontSizes = topLevelKeys(fontSizeBlock);

const apiThemes = stringArray(apiValues, 'THEME_VALUES');
const apiFontSizes = stringArray(apiValues, 'FONT_SIZE_VALUES');

console.log('preferences guard (T4)');

check('字号允许集合在 contracts / design-tokens / api 三处一致', () => {
  assert(
    sameSet(contractFontSizes, tokenFontSizes),
    `contracts=${contractFontSizes} design-tokens=${tokenFontSizes}`,
  );
  assert(
    sameSet(contractFontSizes, apiFontSizes),
    `contracts=${contractFontSizes} api=${apiFontSizes}`,
  );
});

check('主题允许集合在 contracts / design-tokens / api 三处一致', () => {
  assert(
    sameSet(contractThemes, tokenThemes),
    `contracts=${contractThemes} design-tokens=${tokenThemes}`,
  );
  assert(sameSet(contractThemes, apiThemes), `contracts=${contractThemes} api=${apiThemes}`);
});

check('主题预设只引用既有令牌（不出现新的字面色值）', () => {
  assert(!/#[0-9a-fA-F]{3,8}/.test(themeBlock), '主题预设里出现了字面 #hex 颜色');

  const colorKeys = topLevelKeys(objectBlock(tokens, 'colors'));
  const toneKeys = topLevelKeys(objectBlock(tokens, 'semanticColors'));

  const usedColors = [...themeBlock.matchAll(/\bcolors\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  for (const key of usedColors) {
    assert(colorKeys.includes(key), `主题引用了不存在的颜色令牌 colors.${key}`);
  }

  const usedSemantic = [...themeBlock.matchAll(/\bsemanticColors\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  for (const tone of usedSemantic) {
    assert(toneKeys.includes(tone), `主题引用了不存在的语义色 semanticColors.${tone}`);
  }
});

check('字号预设是合法的百分比值', () => {
  for (const [, value] of fontSizeBlock.matchAll(/: '([^']+)'/g)) {
    assert(/^\d+(\.\d+)?%$/.test(value), `字号预设值不是百分比：${value}`);
  }
});

check('契约声明了偏好相关错误码', () => {
  assert(errors.includes("'PREFERENCE_INVALID'"), '缺少 PREFERENCE_INVALID');
  assert(errors.includes("'PREFERENCE_UNAVAILABLE'"), '缺少 PREFERENCE_UNAVAILABLE');
});

if (failures.length > 0) {
  console.error(`\npreferences guard: ${failures.length} 项失败\n`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`\npreferences guard: ${passed} 项通过`);
