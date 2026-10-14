import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryArtifactBytesReader, UnconfiguredArtifactBytesReader } from './artifact-bytes.reader';
import {
  ALLOWED_MEDIA_CONTAINERS,
  MAX_MEDIA_SIGNED_SIZE_BYTES,
  MIN_DEMO_NOTE_LENGTH,
  MediaArtifactResolver,
  MediaEvidenceNotFoundError,
  assessMediaCompliance,
  evaluateMediaCompliance,
  parseContainerHeader,
  toMediaAssessorFacts,
  type MediaArtifactRef,
} from './media-compliance-validator';

/* ------------------------------------------------------------------ *
 * 构造最小容器头部（不依赖任何真实媒体文件）
 * ------------------------------------------------------------------ */

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function box(type: string, body: number[]): number[] {
  return [...u32(body.length + 8), ...Array.from(type).map((char) => char.charCodeAt(0)), ...body];
}

function fixed16x16(value: number): number[] {
  const scaled = Math.round(value * 65536);
  return u32(scaled >>> 0);
}

/** 最小可解析 mp4：ftyp + moov(mvhd + trak(tkhd))。 */
function mp4(options: { durationMs?: number; width?: number; height?: number } = {}): Uint8Array {
  const durationMs = options.durationMs ?? 5000;
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const ftyp = box('ftyp', [...Array.from('isom').map((c) => c.charCodeAt(0)), ...u32(512)]);
  const mvhdBody = [
    ...u32(0), // version/flags（version=0 → 32 位字段）
    ...u32(0), // creation_time
    ...u32(0), // modification_time
    ...u32(1000), // timescale
    ...u32(durationMs), // duration（毫秒刻度）
  ];
  while (mvhdBody.length < 100) mvhdBody.push(0);
  const mvhd = box('mvhd', mvhdBody);
  const tkhdBody = [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(0), ...u32(0)];
  while (tkhdBody.length < 84) tkhdBody.push(0);
  tkhdBody.push(...fixed16x16(width), ...fixed16x16(height));
  const tkhd = box('tkhd', tkhdBody);
  const moov = box('moov', [...mvhd, ...box('trak', tkhd)]);
  return new Uint8Array([...ftyp, ...moov]);
}

/** 手工拼装最小 WebM（EBML）头部：每个元素按 vint 长度编码，逐字节写死。 */
function flatWebm(options: { durationMs?: number; width?: number; height?: number } = {}): Uint8Array {
  const durationMs = options.durationMs ?? 5000;
  const width = options.width ?? 640;
  const height = options.height ?? 480;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, durationMs);
  const durationBytes = Array.from(new Uint8Array(view.buffer));
  return new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x00, 0x00, 0x00, 0x00, // EBML 头（id + size 4 + 4 字节）
    0x44, 0x89, 0x88, ...durationBytes, // Duration（float64，size 8）
    0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, // TimecodeScale = 1_000_000
    0xb0, 0x82, (width >> 8) & 0xff, width & 0xff, // PixelWidth
    0xba, 0x82, (height >> 8) & 0xff, height & 0xff, // PixelHeight
  ]);
}

/* ------------------------------------------------------------------ *
 * 替身
 * ------------------------------------------------------------------ */

class FakeResolver extends MediaArtifactResolver {
  ref: MediaArtifactRef | null = null;
  calls: string[] = [];

  async resolveByObjectKey(objectKey: string): Promise<MediaArtifactRef | null> {
    this.calls.push(objectKey);
    return this.ref;
  }
}

const STUDENT = 'student-1';

function ref(overrides: Partial<MediaArtifactRef> = {}): MediaArtifactRef {
  return {
    artifactId: 'art-1',
    artifactVersionId: 'artv-1',
    objectKey: 'evidence/demo.mp4',
    versionTitle: '机器人演示',
    studentId: STUDENT,
    ...overrides,
  };
}

const LONG_NOTE = '第一步接通电源，第二步按下启动键并观察机械臂抓取，第三步断电收工。';

describe('MediaComplianceValidator（合规元数据，不解码）', () => {
  it('合规视频：容器/大小/时长/分辨率/说明齐 → compliant，且时长来自头部', async () => {
    const reader = new InMemoryArtifactBytesReader();
    reader.seed('evidence/demo.mp4', mp4({ durationMs: 5000, width: 1280, height: 720 }), 'video/mp4');
    const resolver = new FakeResolver();
    resolver.ref = ref();
    const { verdict } = await assessMediaCompliance(
      { resolver, reader, expectedStudentId: STUDENT },
      'evidence/demo.mp4',
      { note: LONG_NOTE },
    );
    assert.equal(verdict.verdict, 'compliant');
    assert.equal(verdict.container, 'mp4');
    assert.equal(verdict.durationSeconds, 5);
    assert.deepEqual(verdict.resolution, { width: 1280, height: 720 });
    assert.equal(verdict.notePresent, true);
    assert.equal(verdict.noteLength, LONG_NOTE.trim().length);
    assert.equal(verdict.issues.length, 0);
    assert.equal(verdict.headerDigest?.length, 64);
  });

  it('webm 容器也能从头部解析时长与分辨率', async () => {
    const reader = new InMemoryArtifactBytesReader();
    reader.seed('evidence/demo.webm', flatWebm({ durationMs: 8000, width: 640, height: 480 }), 'video/webm');
    const resolver = new FakeResolver();
    resolver.ref = ref({ objectKey: 'evidence/demo.webm' });
    const { verdict } = await assessMediaCompliance(
      { resolver, reader, expectedStudentId: STUDENT },
      'evidence/demo.webm',
      { note: LONG_NOTE },
    );
    assert.equal(verdict.container, 'webm');
    assert.equal(verdict.durationSeconds, 8);
    assert.deepEqual(verdict.resolution, { width: 640, height: 480 });
    assert.equal(verdict.verdict, 'compliant');
  });

  it('非允许容器 → non_compliant（魔数说了算，不看扩展名）', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const verdict = evaluateMediaCompliance({
      kind: 'video',
      note: LONG_NOTE,
      sizeBytes: 1024,
      facts: parseContainerHeader(bytes),
      headerDigest: 'd'.repeat(64),
    });
    assert.equal(verdict.verdict, 'non_compliant');
    assert.ok(verdict.issues.includes('MEDIA_CONTAINER_NOT_ALLOWED'));
    assert.equal(verdict.container, null);
  });

  it('超过 512MB 上限 → 大小越界', () => {
    const verdict = evaluateMediaCompliance({
      kind: 'video',
      note: LONG_NOTE,
      sizeBytes: MAX_MEDIA_SIGNED_SIZE_BYTES + 1,
      facts: parseContainerHeader(mp4()),
      headerDigest: 'd'.repeat(64),
    });
    assert.ok(verdict.issues.includes('MEDIA_SIZE_OUT_OF_RANGE'));
    assert.equal(verdict.verdict, 'non_compliant');
  });

  it('缺少人工说明（或太短）→ MEDIA_DEMO_NOTE_REQUIRED', () => {
    const short = evaluateMediaCompliance({
      kind: 'hardware_demo',
      note: '演示了一下',
      sizeBytes: 1024,
      facts: parseContainerHeader(mp4()),
      headerDigest: 'd'.repeat(64),
    });
    assert.ok(short.issues.includes('MEDIA_DEMO_NOTE_REQUIRED'));
    assert.equal(short.notePresent, false);
    assert.equal(short.noteLength, 5);
    const missing = evaluateMediaCompliance({
      kind: 'hardware_demo',
      note: null,
      sizeBytes: 1024,
      facts: parseContainerHeader(mp4()),
      headerDigest: 'd'.repeat(64),
    });
    assert.ok(missing.issues.includes('MEDIA_DEMO_NOTE_REQUIRED'));
    assert.equal(MIN_DEMO_NOTE_LENGTH, 30);
  });

  it('时长 / 分辨率读不出 → 报 unverifiable 项，绝不填默认值', () => {
    // 只有 ftyp、没有 moov：容器能认，时长与分辨率读不到。
    const ftypOnly = new Uint8Array(box('ftyp', [...Array.from('isom').map((c) => c.charCodeAt(0))]));
    const verdict = evaluateMediaCompliance({
      kind: 'video',
      note: LONG_NOTE,
      sizeBytes: 2048,
      facts: parseContainerHeader(ftypOnly),
      headerDigest: 'd'.repeat(64),
    });
    assert.equal(verdict.verdict, 'non_compliant');
    assert.ok(verdict.issues.includes('MEDIA_DURATION_UNREADABLE'));
    assert.ok(verdict.issues.includes('MEDIA_RESOLUTION_UNREADABLE'));
    assert.equal(verdict.durationSeconds, null);
    assert.equal(verdict.resolution, null);
  });

  it('读路径未配置 → verdict=unverifiable（不是 non_compliant）', async () => {
    const resolver = new FakeResolver();
    resolver.ref = ref();
    const { verdict } = await assessMediaCompliance(
      { resolver, reader: new UnconfiguredArtifactBytesReader(), expectedStudentId: STUDENT },
      'evidence/demo.mp4',
      { note: LONG_NOTE },
    );
    assert.equal(verdict.verdict, 'unverifiable');
    assert.deepEqual(verdict.issues, ['MEDIA_BYTES_UNAVAILABLE']);
    assert.equal(verdict.headerDigest, null);
  });

  it('引用不存在 → 抛 MEDIA_EVIDENCE_NOT_FOUND（调用方转 400）', async () => {
    const resolver = new FakeResolver();
    resolver.ref = null;
    const reader = new InMemoryArtifactBytesReader();
    await assert.rejects(
      () => assessMediaCompliance({ resolver, reader, expectedStudentId: STUDENT }, 'nope.mp4', { note: LONG_NOTE }),
      (error: unknown) => (error as MediaEvidenceNotFoundError).code === 'MEDIA_EVIDENCE_NOT_FOUND',
    );
  });

  it('引用属于别的学生 → 同样拒绝（拿别人的作品当证据）', async () => {
    const resolver = new FakeResolver();
    resolver.ref = ref({ studentId: 'student-2' });
    const reader = new InMemoryArtifactBytesReader();
    reader.seed('evidence/demo.mp4', mp4());
    await assert.rejects(
      () => assessMediaCompliance({ resolver, reader, expectedStudentId: STUDENT }, 'evidence/demo.mp4', { note: LONG_NOTE }),
      (error: unknown) => (error as MediaEvidenceNotFoundError).code === 'MEDIA_EVIDENCE_NOT_FOUND',
    );
  });

  it('交给 AI 的内容只有三样：不透明引用 + 合规结论 + 人写说明', async () => {
    const reader = new InMemoryArtifactBytesReader();
    reader.seed('evidence/demo.mp4', mp4(), 'video/mp4');
    const resolver = new FakeResolver();
    resolver.ref = ref();
    const { ref: artifactRef, verdict } = await assessMediaCompliance(
      { resolver, reader, expectedStudentId: STUDENT },
      'evidence/demo.mp4',
      { note: LONG_NOTE },
    );
    const facts = toMediaAssessorFacts({ ref: artifactRef, verdict, note: LONG_NOTE });
    assert.deepEqual(Object.keys(facts).sort(), ['artifactRef', 'compliance', 'note']);
    assert.equal(facts.artifactRef, 'artifact_version:artv-1');
    // 不含字节、不含缩略图、不含转写：序列化里没有任何图片/媒体字段名。
    const serialized = JSON.stringify(facts);
    for (const banned of ['frames', 'thumbnail', 'transcript', 'objectKey', 'uploadUrl', 'audio']) {
      assert.equal(serialized.includes(banned), false, `不该出现 ${banned}`);
    }
  });

  it('允许容器清单与预签名白名单一致（mp4 / webm）', () => {
    assert.deepEqual([...ALLOWED_MEDIA_CONTAINERS], ['mp4', 'webm']);
  });
});
