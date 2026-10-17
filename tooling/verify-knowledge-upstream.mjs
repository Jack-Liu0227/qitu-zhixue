#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const sourceRoot = join(root, 'services/knowledge/source');
const upstreamRoot = join(sourceRoot, 'deeptutor');
const bridgePath = join(root, 'integrations/deeptutor-knowledge/bridge.py');
const expectedPin = '6cf793bd868ba5ecbe64722936d4be8fab5a01df';
const allowedImports = new Set([
  'deeptutor.services.embedding.config',
  'deeptutor.services.embedding',
  'deeptutor.services.rag.service',
  'deeptutor.services.rag.pipelines.llamaindex.config',
]);
const forbiddenModules = [
  'deeptutor.services.skill',
  'deeptutor.tools',
  'deeptutor.services.sandbox',
  'deeptutor.api',
];

function fail(message) {
  console.error(`失败：${message}`);
  process.exitCode = 1;
}

function importsFromBridge(source) {
  return new Set([...source.matchAll(/(?:from|import)\s+(deeptutor(?:\.[A-Za-z0-9_]+)+)/g)].map((match) => match[1]));
}

function checksumTree(directory) {
  const files = [];
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '__pycache__' || entry.name === '.git' || entry.name.endsWith('.pyc')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  visit(directory);
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(relative(directory, path).split('\\').join('/'));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

if (!existsSync(sourceRoot)) {
  fail('上游未安装：services/knowledge/source 不存在');
} else {
  let failed = false;
  const pinPath = join(sourceRoot, 'QITU_PIN');
  if (!existsSync(pinPath) || readFileSync(pinPath, 'utf8').trim() !== expectedPin) {
    console.error(`失败：QITU_PIN 不匹配，期望 ${expectedPin}`);
    failed = true;
  }
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    if (!existsSync(join(sourceRoot, file))) {
      console.error(`失败：缺少 Apache-2.0 合规文件 ${file}`);
      failed = true;
    }
  }
  if (!existsSync(upstreamRoot) || !statSync(upstreamRoot).isDirectory()) {
    console.error('失败：上游未安装：services/knowledge/source/deeptutor 不存在');
    failed = true;
  }
  if (!existsSync(bridgePath)) {
    console.error('失败：缺少 integrations/deeptutor-knowledge/bridge.py');
    failed = true;
  } else {
    const source = readFileSync(bridgePath, 'utf8');
    for (const module of forbiddenModules) {
      if (source.includes(module)) {
        console.error(`失败：bridge.py 包含禁止模块 ${module}`);
        failed = true;
      }
    }
    const actual = importsFromBridge(source);
    if (actual.size !== allowedImports.size || [...allowedImports].some((module) => !actual.has(module))) {
      console.error(`失败：bridge.py import 面不符合白名单，实际为 ${[...actual].sort().join(', ')}`);
      failed = true;
    }
  }
  if (process.argv.includes('--checksum') && existsSync(upstreamRoot)) {
    console.log(`deeptutor checksum: ${checksumTree(upstreamRoot)}`);
  }
  if (failed) process.exitCode = 1;
  else console.log('通过：DeepTutor pin、合规文件、上游目录与 bridge import 面均已校验');
}
