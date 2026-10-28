#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CURRENT = 'Plan/codex';
const REQUIRED = [
  'README.md', 'architecture.md', 'implementation-plan.md', 'skills-catalog.md',
  'mcp-tool-governance.md', 'theme-session-team-ima-design.md', 'gap-audit-20261019.md',
  'optics-scattering-diffraction-analysis.md', 'research-report.md',
  'validation-20261019.md', 'takeover-validation-20261019.md',
  'source-lock.json', 'delivery-status.json',
];
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const STATUSES = new Set(['planned', 'in_progress', 'partial', 'implemented', 'verified']);
const LEVELS = new Set([
  'source', 'compile', 'documentation', 'behavior', 'database', 'configuration',
  'request', 'release', 'push', 'learning-effect',
]);

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function repoFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('expected repository-relative path');
  const resolved = path.resolve(root, relative);
  if (!inside(root, resolved)) throw new Error('path leaves repository');
  if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error(`missing file: ${relative}`);
  if (!inside(realpathSync(root), realpathSync(resolved))) throw new Error('symlink target leaves repository');
  return resolved;
}

function text(file) {
  return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file));
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

export function markdownLinks(markdown) {
  let fence;
  const masked = markdown.split('\n').map(line => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const wasFenced = Boolean(fence);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = undefined;
    }
    return wasFenced || fence ? ' '.repeat(line.length) : line.replace(/(`+)([^\n]*?)\1/g, match => ' '.repeat(match.length));
  }).join('\n');
  const links = [];
  const destination = raw => raw.trim().startsWith('<')
    ? raw.trim().slice(1, raw.trim().indexOf('>'))
    : raw.trim().replace(/\s+["'][\s\S]*$/, '').replace(/\\([() ])/g, '$1');
  for (const match of masked.matchAll(/!?\[[^\]\n]*\]\(/g)) {
    let depth = 1;
    let angle = false;
    const start = match.index + match[0].length;
    for (let index = start; index < masked.length && masked[index] !== '\n'; index++) {
      const char = masked[index];
      if (char === '\\') { index++; continue; }
      if (char === '<') angle = true;
      else if (char === '>') angle = false;
      else if (!angle && char === '(') depth++;
      else if (!angle && char === ')' && --depth === 0) {
        links.push({ line: masked.slice(0, match.index).split('\n').length, href: destination(masked.slice(start, index)) });
        break;
      }
    }
  }
  for (const match of masked.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)) {
    links.push({ line: masked.slice(0, match.index).split('\n').length, href: destination(match[1]) });
  }
  return links;
}

export function localTarget(root, document, href) {
  if (!href || href.startsWith('#') || href.startsWith('//')) return undefined;
  if (/^(file:|[A-Za-z]:[\\/])/i.test(href)) throw new Error('nonportable local file URL');
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return undefined;
  const pathname = decodeURIComponent(href.split(/[?#]/, 1)[0]);
  if (!pathname) return undefined;
  const target = pathname.startsWith('/')
    ? path.resolve(root, pathname.replace(/^\/+/, ''))
    : path.resolve(path.dirname(document), pathname);
  if (!inside(root, target)) throw new Error('local link leaves repository');
  if (!existsSync(target)) throw new Error(`missing local target: ${href}`);
  if (!inside(realpathSync(root), realpathSync(target))) throw new Error('local link symlink leaves repository');
  return target;
}

export function archiveHashMatches(bytes, digest) {
  return SHA256.test(digest) && createHash('sha256').update(bytes).digest('hex') === digest;
}

function validateSources(lock, requireCondition) {
  requireCondition(lock.schemaVersion === 1 && COMMIT.test(lock.codeBaseline), 'invalid source lock version/baseline');
  requireCondition(Array.isArray(lock.records) && lock.records.length > 0, 'source lock records missing');
  const ids = new Set();
  for (const record of lock.records ?? []) {
    requireCondition(typeof record.id === 'string' && !ids.has(record.id), `duplicate/invalid source id: ${record.id}`);
    ids.add(record.id);
    requireCondition(/^https:\/\//.test(record.url) && /^https:\/\//.test(record.resolvedUrl), `invalid source URL: ${record.id}`);
    requireCondition(record.status === 200 && Number.isInteger(record.bytes) && record.bytes > 0 && SHA256.test(record.sha256), `invalid fetch evidence: ${record.id}`);
    requireCondition(Number.isFinite(Date.parse(record.fetchedAt)), `invalid fetch time: ${record.id}`);
  }
  for (const repository of lock.repositories ?? []) {
    requireCondition(COMMIT.test(repository.commit) && repository.treeTruncated === false, `unpinned/incomplete repository: ${repository.repository}`);
  }
  for (const search of lock.grokSearches ?? []) {
    requireCondition(typeof search.sessionId === 'string' && Number.isInteger(search.sourcesCount), 'invalid Grok record');
    if (search.sourcesCount === 0) requireCondition(search.sourceListCount === 0 && search.decision === 'Excluded as evidence', `zero-source search used as evidence: ${search.sessionId}`);
  }
  requireCondition(lock.implementationReuse?.refetched === false, 'implementation reuse must not claim a new fetch');
}

export function validateStatus(status, requireCondition, checkRecord = () => {}) {
  requireCondition(status.schemaVersion === 1 && COMMIT.test(status.codeBaseline), 'invalid delivery version/baseline');
  const inventory = status.skillInventory ?? {};
  requireCondition(inventory.existingSourceCount === 1 && inventory.firstBatchCandidateCount === 8 && inventory.laterCandidateCount === 6, 'skill plan must distinguish 1 existing, 8 first-batch and 6 later candidates');
  requireCondition(inventory.newPublishedCount === 0, 'this slice must not claim newly published teaching Skills');
  const evidence = new Map();
  for (const entry of status.evidence ?? []) {
    requireCondition(typeof entry.id === 'string' && !evidence.has(entry.id), `duplicate/invalid evidence: ${entry.id}`);
    evidence.set(entry.id, entry);
    requireCondition(LEVELS.has(entry.level) && ['recorded', 'passed', 'failed', 'not_run'].includes(entry.status), `invalid evidence level/status: ${entry.id}`);
    checkRecord(entry.record);
    if (entry.status === 'passed') {
      requireCondition(typeof entry.command === 'string' && entry.command.length > 0 && entry.exitCode === 0, `missing successful command evidence: ${entry.id}`);
      requireCondition(Number.isFinite(Date.parse(entry.executedAt)) && typeof entry.result === 'string' && entry.result.length > 0, `missing execution time/result: ${entry.id}`);
    }
  }
  const seen = new Set();
  for (const milestone of status.milestones ?? []) {
    requireCondition(typeof milestone.id === 'string' && !seen.has(milestone.id) && STATUSES.has(milestone.status), `invalid milestone: ${milestone.id}`);
    seen.add(milestone.id);
    requireCondition(Array.isArray(milestone.evidenceIds) && typeof milestone.remaining === 'string', `missing milestone scope: ${milestone.id}`);
    const refs = (milestone.evidenceIds ?? []).map(id => {
      requireCondition(evidence.has(id), `unknown evidence ${id} for ${milestone.id}`);
      return evidence.get(id);
    }).filter(Boolean);
    if (milestone.status === 'implemented') requireCondition(refs.some(ref => ref.level === 'source'), `implemented milestone lacks source evidence: ${milestone.id}`);
    if (milestone.status === 'verified') {
      const level = milestone.id === 'M1-docs' ? 'documentation' : 'behavior';
      requireCondition(refs.some(ref => ref.level === level && ref.status === 'passed'), `verified milestone lacks ${level} evidence: ${milestone.id}`);
    }
    if (['planned', 'in_progress', 'partial'].includes(milestone.status)) requireCondition(milestone.remaining.trim().length > 0, `unfinished milestone lacks remaining scope: ${milestone.id}`);
  }
  for (const id of ['M0', 'M1-contract', 'M1-compiler', 'M1-runtime-identity', 'M1-docs', 'M2', 'M3', 'M4', 'M5', 'M6']) requireCondition(seen.has(id), `missing milestone: ${id}`);
  for (const [flag, level] of [['deployed', 'release'], ['pushed', 'push']]) {
    requireCondition(typeof status.production?.[flag] === 'boolean', `missing production ${flag} flag`);
    if (status.production?.[flag]) requireCondition((status.production.evidenceIds ?? []).some(id => {
      const ref = evidence.get(id);
      return ref?.level === level && ref.status === 'passed' && COMMIT.test(ref.artifactCommit);
    }), `production ${flag} lacks ${level} evidence and artifact commit`);
  }
}

function check(root) {
  const problems = [];
  const counts = { documents: 0, links: 0, manifests: 0, archiveFiles: 0, jsonFiles: 0 };
  const requireCondition = (condition, message) => { if (!condition) problems.push(message); };
  const attempt = (label, callback) => { try { return callback(); } catch (error) { problems.push(`${label}: ${error.message}`); } };
  for (const file of REQUIRED) attempt(file, () => repoFile(root, `${CURRENT}/${file}`));
  const current = filesUnder(path.join(root, CURRENT));
  const indexes = filesUnder(path.join(root, 'Plan/archive')).filter(file => path.basename(file) === 'manifest.json');
  const documents = current.filter(file => file.endsWith('.md'));
  const json = new Map();
  for (const file of current.filter(file => file.endsWith('.json'))) {
    counts.jsonFiles++;
    attempt(path.relative(root, file), () => json.set(path.basename(file), JSON.parse(text(file))));
  }
  for (const manifestFile of indexes) attempt(path.relative(root, manifestFile), () => {
    const manifest = JSON.parse(text(manifestFile));
    counts.manifests++;
    requireCondition(manifest.schemaVersion === 1 && COMMIT.test(manifest.sourceCommit), `invalid archive manifest: ${path.relative(root, manifestFile)}`);
    requireCondition(Array.isArray(manifest.entries) && manifest.entries.length > 0, 'archive manifest has no entries');
    const seen = new Set();
    for (const entry of manifest.entries ?? []) attempt(entry.archived, () => {
      requireCondition(!seen.has(entry.archived), `duplicate archive entry: ${entry.archived}`);
      seen.add(entry.archived);
      const archive = repoFile(root, entry.archived);
      requireCondition(inside(path.dirname(manifestFile), archive), `snapshot leaves manifest directory: ${entry.archived}`);
      requireCondition(archiveHashMatches(readFileSync(archive), entry.sha256), `archive SHA-256 mismatch: ${entry.archived}`);
      repoFile(root, entry.replacement);
      counts.archiveFiles++;
    });
    const index = path.join(path.dirname(manifestFile), 'README.md');
    if (existsSync(index)) documents.push(index);
  });
  requireCondition(counts.manifests > 0, 'no archive manifests found');
  for (const file of documents) attempt(path.relative(root, file), () => {
    counts.documents++;
    const body = text(file);
    if (inside(path.join(root, CURRENT), file)) requireCondition(/^> 状态：/m.test(body), `missing explicit status: ${path.relative(root, file)}`);
    for (const link of markdownLinks(body)) attempt(`${path.relative(root, file)}:${link.line}`, () => {
      if (localTarget(root, file, link.href)) counts.links++;
    });
  });
  if (json.has('source-lock.json')) attempt('source-lock.json', () => validateSources(json.get('source-lock.json'), requireCondition));
  if (json.has('delivery-status.json')) attempt('delivery-status.json', () => validateStatus(json.get('delivery-status.json'), requireCondition, record => repoFile(root, record)));
  requireCondition(json.get('source-lock.json')?.codeBaseline === json.get('delivery-status.json')?.codeBaseline, 'source/delivery baselines differ');
  return { counts, problems };
}

function selfTest() {
  let cases = 0;
  const test = callback => { callback(); cases++; };
  test(() => assert.deepEqual(markdownLinks('[ok](./file.md)\n`[skip](bad)`\n```md\n[x](bad)\n```\n[ref]: <other.md>'), [{ line: 1, href: './file.md' }, { line: 6, href: 'other.md' }]));
  test(() => assert.equal(markdownLinks('[nested](thing(a).md "title")')[0].href, 'thing(a).md'));
  test(() => assert.equal(localTarget(ROOT, path.join(ROOT, CURRENT, 'README.md'), 'https://example.invalid/'), undefined));
  test(() => assert.throws(() => localTarget(ROOT, path.join(ROOT, 'README.md'), '../outside.md'), /leaves repository/));
  test(() => assert.throws(() => localTarget(ROOT, path.join(ROOT, 'README.md'), 'file:///C:/secret'), /nonportable/));
  test(() => assert.throws(() => localTarget(ROOT, path.join(ROOT, 'README.md'), './missing-codex-fixture.md'), /missing local target/));
  test(() => assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from([0xc3, 0x28]))));
  test(() => {
    const digest = createHash('sha256').update('original\r\n').digest('hex');
    assert.equal(archiveHashMatches(Buffer.from('original\r\n'), digest), true);
    assert.equal(archiveHashMatches(Buffer.from('original\n'), digest), false);
  });
  const original = JSON.parse(text(path.join(ROOT, CURRENT, 'delivery-status.json')));
  test(() => {
    const changed = structuredClone(original);
    changed.milestones.find(item => item.id === 'M0').status = 'verified';
    changed.milestones.find(item => item.id === 'M0').evidenceIds = [];
    const problems = [];
    validateStatus(changed, (condition, message) => { if (!condition) problems.push(message); });
    assert.ok(problems.some(message => message.includes('lacks behavior evidence: M0')));
  });
  test(() => {
    const changed = structuredClone(original);
    changed.production.deployed = true;
    changed.production.evidenceIds = [];
    const problems = [];
    validateStatus(changed, (condition, message) => { if (!condition) problems.push(message); });
    assert.ok(problems.some(message => message.includes('production deployed lacks release')));
  });
  test(() => {
    const lock = JSON.parse(text(path.join(ROOT, CURRENT, 'source-lock.json')));
    lock.grokSearches[0].decision = 'Accepted as evidence';
    const problems = [];
    validateSources(lock, (condition, message) => { if (!condition) problems.push(message); });
    assert.ok(problems.some(message => message.includes('zero-source search used as evidence')));
  });
  console.log(`Codex plan self-tests: ${cases} passed; no files written.`);
}

if (process.argv.includes('--self-test')) selfTest();
else {
  const { counts, problems } = check(ROOT);
  for (const problem of problems) console.error(problem);
  console.log(`Codex plan: ${counts.documents} documents, ${counts.links} local links, ${counts.jsonFiles} JSON files, ${counts.manifests} archive manifests, ${counts.archiveFiles} archive hashes, ${problems.length} problems.`);
  console.log('Read-only structural/evidence check; no network, business tests or deployment performed.');
  process.exitCode = problems.length ? 1 : 0;
}
