import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ARTIFACT_BYTES_READ_NOT_CONFIGURED, type ArtifactBytesReader } from './artifact-bytes.reader';

/**
 * 代码「**静态**检查」生产者（雷霆战机 / 可运行代码类作品）。
 *
 * =========================== 语义红线（READ ME FIRST）===========================
 *
 * 本生产者**只**做两件事：
 * 1. 结构检查——入口文件（`main.py`）与声明的模块文件是否都在；
 * 2. 语法检查——把**临时副本**交给 Python 做语法编译（`py_compile`），
 *    记录校验器版本 + 被检字节的 sha256 + 结果。
 *
 * 它**绝不**、任何情况下都**不得**被表述为「已验证可运行 / 可玩」：
 *
 * - `Plan/research/pbl-gate-producers.md` §方案 C 已用仓库自己的话写下这个陷阱：
 *   **语法通过 ≠ 能运行 ≠ 可玩**（`import pygame` 静态能过，无显示器就崩）。
 * - 因此本生产者**不写** `code_playable_run_verified` 门禁。静态结论与门禁名
 *   （playable / run / verified）语义相反，写了就是伪造。
 * - 返回的 `semanticScope` 字段恒为字面量 `'static_only'`，并带一条
 *   `NOT_A_RUN_VERIFICATION` 说明，任何消费方都无法把它误读成运行验证。
 *
 * 好消息：`source: 'runner'` 已经在 `PBL_GATE_SOURCE_WHITELIST` 里注册给了
 * `code_playable_run_verified`（见 `packages/ai-client/src/pbl-team.ts`），
 * 将来真正的容器 runner 上线时**不需要**改白名单——本工作流刻意保留该条目。
 *
 * 真实运行验证需要：无网络容器 / 微 VM、CPU 与墙钟配额、除 scratch 外的只读
 * 文件系统、以及 headless 显示垫片（游戏要 SDL + 显示才能进主循环）。
 * 在 API 进程里跑学生代码会把整个多租户服务端与未成年人数据暴露出去，
 * 所以这是一项**已声明的基础设施延后项**，不是本文件能绕过的实现细节。
 */

export const CODE_STATIC_VALIDATOR_VERSION = 'code-static-v1';

/** 语义范围：恒为静态。消费方据此拒绝把它当成运行验证。 */
export const CODE_STATIC_SEMANTIC_SCOPE = 'static_only' as const;

/** 稳定的「这不是运行验证」说明（同时进证据 detail 与日志）。 */
export const NOT_A_RUN_VERIFICATION =
  '静态语法/结构检查：不等于可运行，更不等于可玩；不得据此声明 code_playable_run_verified';

/** 单文件上限：语法检查的临时副本不应超过 2MB。 */
export const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

/** 语法检查整体超时（毫秒）：编译单文件通常 <1s，超时即判 unavailable。 */
export const PYTHON_SYNTAX_CHECK_TIMEOUT_MS = 10_000;

export interface CodeStaticCheckInput {
  /** 入口文件：必须在版本文件集中存在。 */
  entryFile: string;
  /** 其它必需文件（例如 `settings.py`）。 */
  requiredFiles?: readonly string[];
  /** 已随版本登记的附加文件（服务端记录，非本次新增字段）。 */
  companionFiles?: readonly string[];
}

export interface CodeStaticCheckFinding {
  file: string;
  present: boolean;
  byteLength: number | null;
  sha256: string | null;
}

export interface PythonSyntaxCheckResult {
  /** `ok` = 语法编译通过；`error` = 语法错误；`unavailable` = 本机无 Python 或超时。 */
  status: 'ok' | 'error' | 'unavailable';
  /** 编译器 / 解释器版本串（如 `3.12.4`），无法取得为 null。 */
  runtimeVersion: string | null;
  /** 语法错误信息（**已截断且不含源码行**，只保留位置与消息）。 */
  message: string | null;
}

/** 语法检查端口：默认实现调用本机 Python，测试可注入确定性的假实现。 */
export abstract class PythonSyntaxChecker {
  abstract check(files: readonly { filename: string; bytes: Uint8Array }[]): Promise<PythonSyntaxCheckResult>;
}

/**
 * 默认实现：把字节写到**系统临时目录**的独立子目录，跑
 * `python -m py_compile`（只编译、不执行模块顶层代码的副作用——
 * `py_compile` 走编译流程，不 import 被检文件）。
 *
 * 注意：`py_compile` 语法检查本身不需要网络，也不需要显示；
 * 它**不能**证明 import 成功、依赖存在、或游戏能进主循环。
 */
export class LocalPythonSyntaxChecker extends PythonSyntaxChecker {
  constructor(
    private readonly pythonCommand: string = process.platform === 'win32' ? 'python' : 'python3',
    private readonly timeoutMs: number = PYTHON_SYNTAX_CHECK_TIMEOUT_MS,
  ) {
    super();
  }

  async check(files: readonly { filename: string; bytes: Uint8Array }[]): Promise<PythonSyntaxCheckResult> {
    if (files.length === 0) return { status: 'unavailable', runtimeVersion: null, message: '没有可检查的文件' };
    let dir: string | null = null;
    try {
      dir = await mkdtemp(join(tmpdir(), 'qitu-static-'));
      const written: string[] = [];
      for (const file of files) {
        const safeName = file.filename.replace(/[\\/]+/g, '_');
        const target = join(dir, safeName.endsWith('.py') ? safeName : `${safeName}.py`);
        await writeFile(target, file.bytes);
        written.push(target);
      }
      const version = await this.run([this.pythonCommand, '--version']);
      const compiled = await this.run([this.pythonCommand, '-m', 'py_compile', ...written], this.timeoutMs);
      if (compiled.timedOut) {
        return { status: 'unavailable', runtimeVersion: version.stdout.trim() || null, message: '语法检查超时' };
      }
      if (compiled.code === 0) {
        return { status: 'ok', runtimeVersion: version.stdout.trim() || version.stderr.trim() || null, message: null };
      }
      return {
        status: 'error',
        runtimeVersion: version.stdout.trim() || version.stderr.trim() || null,
        // 只保留一行摘要（py_compile 的输出是「位置 + 消息」，不含源码正文）。
        message: truncateMessage(compiled.stderr || compiled.stdout),
      };
    } catch (error) {
      // 本机没有 Python / 进程起不来：这是「不可判定」，不是「语法错误」。
      return {
        status: 'unavailable',
        runtimeVersion: null,
        message: `无法运行 Python 语法检查：${(error as Error)?.message ?? String(error)}`,
      };
    } finally {
      if (dir !== null) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private run(argv: readonly string[], timeoutMs = PYTHON_SYNTAX_CHECK_TIMEOUT_MS): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(argv[0]!, argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr, timedOut });
      });
    });
  }
}

function truncateMessage(raw: string): string {
  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).pop() ?? '';
  return firstLine.slice(0, 200);
}

export interface CodeStaticCheckReport {
  validatorVersion: string;
  /** 恒为 `'static_only'`：消费方据此拒绝把它当成运行验证。 */
  semanticScope: typeof CODE_STATIC_SEMANTIC_SCOPE;
  artifactId: string;
  artifactVersionId: string;
  entryFile: string;
  files: readonly CodeStaticCheckFinding[];
  syntax: PythonSyntaxCheckResult;
  /** `structure_ok` / `structure_missing` / `syntax_ok` / `syntax_error` / `unavailable`。 */
  verdict: 'structure_ok' | 'structure_missing' | 'syntax_ok' | 'syntax_error' | 'unavailable';
  issues: readonly string[];
  /** 恒含 `NOT_A_RUN_VERIFICATION`：把语义红线写进数据本身。 */
  disclosures: readonly string[];
}

export interface CodeArtifactRef {
  artifactId: string;
  artifactVersionId: string;
  studentId: string;
  /** objectKey → 该文件在本次版本登记中的文件名。 */
  files: readonly { filename: string; objectKey: string }[];
}

/** 由持久化层提供的「这个版本登记了哪些文件」解析端口。 */
export abstract class CodeArtifactResolver {
  abstract resolve(artifactVersionId: string): Promise<CodeArtifactRef | null>;
}

export const CODE_ARTIFACT_NOT_FOUND = 'CODE_ARTIFACT_NOT_FOUND';

export class CodeArtifactNotFoundError extends Error {
  readonly code = CODE_ARTIFACT_NOT_FOUND;

  constructor(message = '作品版本不存在或未登记任何源文件') {
    super(message);
    this.name = 'CodeArtifactNotFoundError';
  }
}

/**
 * 生产者入口：结构检查 → 语法检查 → 报告。
 *
 * 结论里**没有**「runnable」/「playable」/「verified」三个词的位置；
 * `verdict: 'syntax_ok'` 的准确含义是「语法编译通过」。
 */
export async function runCodeStaticCheck(deps: {
  resolver: CodeArtifactResolver;
  reader: ArtifactBytesReader;
  syntaxChecker: PythonSyntaxChecker;
}, artifactVersionId: string, input: CodeStaticCheckInput): Promise<CodeStaticCheckReport> {
  const ref = await deps.resolver.resolve(artifactVersionId);
  if (ref === null) throw new CodeArtifactNotFoundError();

  const wanted = [input.entryFile, ...(input.requiredFiles ?? [])];
  const byName = new Map<string, string>();
  for (const file of ref.files) {
    if (!byName.has(file.filename)) byName.set(file.filename, file.objectKey);
  }

  const findings: CodeStaticCheckFinding[] = [];
  const issues: string[] = [];
  const checked: { filename: string; bytes: Uint8Array }[] = [];

  for (const filename of wanted) {
    const objectKey = byName.get(filename);
    if (objectKey === undefined) {
      findings.push({ file: filename, present: false, byteLength: null, sha256: null });
      issues.push(`CODE_FILE_MISSING:${filename}`);
      continue;
    }
    let bytes: Uint8Array | null = null;
    let unavailable = false;
    try {
      bytes = await deps.reader.read(objectKey, MAX_SOURCE_FILE_BYTES);
    } catch (error) {
      const code = (error as { code?: string }).code;
      // 只把「读路径未配置」当成不可读；其它错误照常冒泡。
      if (code !== ARTIFACT_BYTES_READ_NOT_CONFIGURED) throw error;
      unavailable = true;
    }
    if (bytes === null || unavailable) {
      // 读不到 ≠ 文件缺失：报 unavailable，绝不写成「结构不合格」。
      findings.push({ file: filename, present: true, byteLength: null, sha256: null });
      issues.push(`CODE_BYTES_UNAVAILABLE:${filename}`);
      continue;
    }
    findings.push({
      file: filename,
      present: true,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    checked.push({ filename, bytes });
  }

  if (issues.some((issue) => issue.startsWith('CODE_BYTES_UNAVAILABLE'))) {
    return {
      validatorVersion: CODE_STATIC_VALIDATOR_VERSION,
      semanticScope: CODE_STATIC_SEMANTIC_SCOPE,
      artifactId: ref.artifactId,
      artifactVersionId,
      entryFile: input.entryFile,
      files: findings,
      syntax: { status: 'unavailable', runtimeVersion: null, message: '源文件字节不可读（对象存储读路径未配置）' },
      verdict: 'unavailable',
      issues,
      disclosures: [NOT_A_RUN_VERIFICATION],
    };
  }

  if (issues.length > 0) {
    return {
      validatorVersion: CODE_STATIC_VALIDATOR_VERSION,
      semanticScope: CODE_STATIC_SEMANTIC_SCOPE,
      artifactId: ref.artifactId,
      artifactVersionId,
      entryFile: input.entryFile,
      files: findings,
      syntax: { status: 'unavailable', runtimeVersion: null, message: '结构不完整，未执行语法检查' },
      verdict: 'structure_missing',
      issues,
      disclosures: [NOT_A_RUN_VERIFICATION],
    };
  }

  const syntax = await deps.syntaxChecker.check(checked);
  const verdict: CodeStaticCheckReport['verdict'] = syntax.status === 'ok'
    ? 'syntax_ok'
    : syntax.status === 'error'
      ? 'syntax_error'
      : 'unavailable';
  if (syntax.status !== 'ok') issues.push(`PY_SYNTAX_${syntax.status.toUpperCase()}`);

  return {
    validatorVersion: CODE_STATIC_VALIDATOR_VERSION,
    semanticScope: CODE_STATIC_SEMANTIC_SCOPE,
    artifactId: ref.artifactId,
    artifactVersionId,
    entryFile: input.entryFile,
    files: findings,
    syntax,
    verdict,
    issues,
    disclosures: [
      NOT_A_RUN_VERIFICATION,
      syntax.status === 'ok'
        ? '语法编译通过；未 import、未运行、未进入主循环。'
        : '未取得语法结论，不得据此推进任何门禁。',
    ],
  };
}

/** 证据 label：把「静态」二字写进人可读文本，避免被读成运行验证。 */
export function codeStaticCheckLabel(report: CodeStaticCheckReport): string {
  return `代码静态检查（${report.validatorVersion}，静态范围）：${report.verdict}`;
}

/** 稳定幂等键：同一版本 + 同一组被检字节 + 同一校验器版本只落一行。 */
export function codeStaticCheckKey(report: CodeStaticCheckReport): string {
  const digest = createHash('sha256')
    .update([report.artifactVersionId, report.validatorVersion, report.verdict, ...report.files.map((f) => `${f.file}:${f.sha256 ?? 'absent'}`)].join('|'))
    .digest('hex');
  return `code-static:${report.artifactVersionId}:${digest.slice(0, 40)}`;
}
