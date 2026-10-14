import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';

import { InMemoryArtifactBytesReader, UnconfiguredArtifactBytesReader } from './artifact-bytes.reader';
import {
  CODE_ARTIFACT_NOT_FOUND,
  CODE_STATIC_SEMANTIC_SCOPE,
  CODE_STATIC_VALIDATOR_VERSION,
  CodeArtifactResolver,
  LocalPythonSyntaxChecker,
  NOT_A_RUN_VERIFICATION,
  PythonSyntaxChecker,
  codeStaticCheckKey,
  codeStaticCheckLabel,
  runCodeStaticCheck,
  type CodeArtifactRef,
  type PythonSyntaxCheckResult,
} from './code-static-check-producer';

const ENTRY = 'main.py';
const STUDENT = 'student-1';

class FakeCodeResolver extends CodeArtifactResolver {
  ref: CodeArtifactRef | null = null;

  async resolve(): Promise<CodeArtifactRef | null> {
    return this.ref;
  }
}

class FakeSyntaxChecker extends PythonSyntaxChecker {
  calls: { filename: string; bytes: Uint8Array }[][] = [];
  result: PythonSyntaxCheckResult = { status: 'ok', runtimeVersion: '3.12.4', message: null };

  async check(files: readonly { filename: string; bytes: Uint8Array }[]): Promise<PythonSyntaxCheckResult> {
    this.calls.push(files.map((file) => ({ filename: file.filename, bytes: file.bytes })));
    return this.result;
  }
}

function makeDeps(files: Record<string, string>, refs: { filename: string; objectKey: string }[]): {
  resolver: FakeCodeResolver;
  reader: InMemoryArtifactBytesReader;
  syntaxChecker: FakeSyntaxChecker;
} {
  const reader = new InMemoryArtifactBytesReader();
  for (const [objectKey, content] of Object.entries(files)) reader.seed(objectKey, content);
  const resolver = new FakeCodeResolver();
  resolver.ref = {
    artifactId: 'art-1',
    artifactVersionId: 'artv-1',
    studentId: STUDENT,
    files: refs,
  };
  return { resolver, reader, syntaxChecker: new FakeSyntaxChecker() };
}

describe('CodeStaticCheckProducer（静态范围，不是运行验证）', () => {
  it('结构齐 + 语法通过 → verdict=syntax_ok，且语义范围恒为 static_only', async () => {
    const deps = makeDeps(
      { 'code/main.py': 'import pygame\nprint("ok")\n', 'code/settings.py': 'FPS = 60\n' },
      [{ filename: ENTRY, objectKey: 'code/main.py' }, { filename: 'settings.py', objectKey: 'code/settings.py' }],
    );
    const report = await runCodeStaticCheck(deps, 'artv-1', { entryFile: ENTRY, requiredFiles: ['settings.py'] });
    assert.equal(report.verdict, 'syntax_ok');
    assert.equal(report.semanticScope, CODE_STATIC_SEMANTIC_SCOPE);
    assert.equal(report.validatorVersion, CODE_STATIC_VALIDATOR_VERSION);
    assert.equal(report.files.length, 2);
    assert.equal(report.files.every((file) => file.present), true);
    // sha256 是对**被检字节**的摘要，且与内容一致。
    assert.equal(
      report.files[0]?.sha256,
      createHash('sha256').update('import pygame\nprint("ok")\n').digest('hex'),
    );
    assert.equal(deps.syntaxChecker.calls.length, 1);
  });

  it('报告自带宽限声明：绝不出现 runnable / playable / verified 的结论位', async () => {
    const deps = makeDeps({ 'code/main.py': 'x = 1\n' }, [{ filename: ENTRY, objectKey: 'code/main.py' }]);
    const report = await runCodeStaticCheck(deps, 'artv-1', { entryFile: ENTRY });
    assert.ok(report.disclosures.includes(NOT_A_RUN_VERIFICATION));
    const lower = JSON.stringify(report).toLowerCase();
    assert.equal(lower.includes('"runnable"'), false);
    assert.equal(lower.includes('"playable"'), false);
    assert.equal(lower.includes('verified_run'), false);
    const label = codeStaticCheckLabel(report);
    assert.ok(label.includes('静态'));
  });

  it('入口文件缺失 → structure_missing，且不调用语法检查', async () => {
    const deps = makeDeps({ 'code/settings.py': 'FPS = 60\n' }, [{ filename: 'settings.py', objectKey: 'code/settings.py' }]);
    const report = await runCodeStaticCheck(deps, 'artv-1', { entryFile: ENTRY, requiredFiles: ['settings.py'] });
    assert.equal(report.verdict, 'structure_missing');
    assert.ok(report.issues.includes(`CODE_FILE_MISSING:${ENTRY}`));
    assert.equal(deps.syntaxChecker.calls.length, 0);
  });

  it('版本未登记任何源文件 → 结构缺失（不假装读到了代码）', async () => {
    const deps = makeDeps({}, []);
    const report = await runCodeStaticCheck(deps, 'artv-1', { entryFile: ENTRY });
    assert.equal(report.verdict, 'structure_missing');
    assert.ok(report.issues.includes(`CODE_FILE_MISSING:${ENTRY}`));
  });

  it('语法错误 → verdict=syntax_error（引用、版本、摘要仍被记录）', async () => {
    const deps = makeDeps({ 'code/main.py': 'def broken(:\n' }, [{ filename: ENTRY, objectKey: 'code/main.py' }]);
    deps.syntaxChecker.result = { status: 'error', runtimeVersion: '3.12.4', message: 'SyntaxError: invalid syntax' };
    const report = await runCodeStaticCheck(deps, 'artv-1', { entryFile: ENTRY });
    assert.equal(report.verdict, 'syntax_error');
    assert.ok(report.issues.includes('PY_SYNTAX_ERROR'));
    assert.equal(report.syntax.message, 'SyntaxError: invalid syntax');
    assert.equal(report.files[0]?.sha256?.length, 64);
  });

  it('无 Python / 超时 → verdict=unavailable（不是语法错误，也不是通过）', async () => {
    const deps = makeDeps({ 'code/main.py': 'x = 1\n' }, [{ filename: ENTRY, objectKey: 'code/main.py' }]);
    deps.syntaxChecker.result = { status: 'unavailable', runtimeVersion: null, message: 'no python' };
    const report = await runCodeStaticCheck(deps, 'artv-1', { entryFile: ENTRY });
    assert.equal(report.verdict, 'unavailable');
    assert.ok(report.issues.includes('PY_SYNTAX_UNAVAILABLE'));
  });

  it('读路径未配置 → unavailable（绝不写成结构不合格）', async () => {
    const resolver = new FakeCodeResolver();
    resolver.ref = {
      artifactId: 'art-1',
      artifactVersionId: 'artv-1',
      studentId: STUDENT,
      files: [{ filename: ENTRY, objectKey: 'code/main.py' }],
    };
    const report = await runCodeStaticCheck(
      { resolver, reader: new UnconfiguredArtifactBytesReader(), syntaxChecker: new FakeSyntaxChecker() },
      'artv-1',
      { entryFile: ENTRY },
    );
    assert.equal(report.verdict, 'unavailable');
    assert.ok(report.issues.includes(`CODE_BYTES_UNAVAILABLE:${ENTRY}`));
    assert.equal(report.files[0]?.present, true);
    assert.equal(report.files[0]?.sha256, null);
  });

  it('版本不存在 → 抛 CODE_ARTIFACT_NOT_FOUND', async () => {
    const deps = makeDeps({}, []);
    deps.resolver.ref = null;
    await assert.rejects(
      () => runCodeStaticCheck(deps, 'missing', { entryFile: ENTRY }),
      (error: unknown) => (error as { code?: string }).code === CODE_ARTIFACT_NOT_FOUND,
    );
  });

  it('幂等键：同版本同字节稳定；字节变化则变化', async () => {
    const first = makeDeps({ 'code/main.py': 'x = 1\n' }, [{ filename: ENTRY, objectKey: 'code/main.py' }]);
    const reportA = await runCodeStaticCheck(first, 'artv-1', { entryFile: ENTRY });
    const reportB = await runCodeStaticCheck(first, 'artv-1', { entryFile: ENTRY });
    assert.equal(codeStaticCheckKey(reportA), codeStaticCheckKey(reportB));

    const second = makeDeps({ 'code/main.py': 'x = 2\n' }, [{ filename: ENTRY, objectKey: 'code/main.py' }]);
    const reportC = await runCodeStaticCheck(second, 'artv-1', { entryFile: ENTRY });
    assert.notEqual(codeStaticCheckKey(reportA), codeStaticCheckKey(reportC));
  });

  it('真实 Python 语法检查（本机有 python 才断言通过；否则必须报 unavailable）', async () => {
    if (!hasPython()) {
      // 诚实记录：本机无 Python 时这条不做断言，但也不假装通过。
      const checker = new LocalPythonSyntaxChecker('definitely-no-such-python-binary');
      const result = await checker.check([{ filename: 'main.py', bytes: new TextEncoder().encode('x = 1\n') }]);
      assert.equal(result.status, 'unavailable');
      return;
    }
    const checker = new LocalPythonSyntaxChecker();
    const good = await checker.check([{
      filename: 'main.py',
      bytes: new TextEncoder().encode('import pygame\n\ndef main():\n    pass\n'),
    }]);
    assert.equal(good.status, 'ok');
    assert.ok((good.runtimeVersion ?? '').length > 0);

    const bad = await checker.check([{ filename: 'main.py', bytes: new TextEncoder().encode('def broken(:\n') }]);
    assert.equal(bad.status, 'error');
    // 错误信息只保留位置与消息，**不含源码正文**。
    assert.equal((bad.message ?? '').includes('def broken'), false);
  });
});

function hasPython(): boolean {
  const probe = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['--version']);
  return probe.status === 0;
}
