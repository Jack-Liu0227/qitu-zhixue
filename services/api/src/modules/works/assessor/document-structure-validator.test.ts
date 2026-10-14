import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryArtifactBytesReader } from './artifact-bytes.reader';
import {
  DOCUMENT_VALIDATOR_VERSION,
  KINETIC_ENERGY_REPORT_PROFILE,
  analyseDocument,
  documentEvidenceLabel,
  toDocumentEvidenceRef,
  validateDocumentStructure,
} from './document-structure-validator';

/**
 * 固定的「动能定理」报告样本：结构齐全。
 * 判定只到**结构**层：本文件里没有任何一条断言涉及「误差是否 <5%」。
 */
const COMPLETE_REPORT = `# 实验报告标题

## 实验目的

用斜面小车验证动能定理。

## 原理公式

$$W = \\Delta E_k = \\frac{1}{2}mv_2^2 - \\frac{1}{2}mv_1^2$$

## 数据表格

| 质量 | 倾角 | 初速 | 末速 | W | ΔEk |
| --- | --- | --- | --- | --- | --- |
| 0.5 | 15 | 0.42 | 1.11 | 0.267 | 0.265 |
| 1.0 | 15 | 0.40 | 1.53 | 0.979 | 0.971 |

## 图表

![速度-时间关系](./chart.png)

## 误差分析

相对误差 0.75%。

## 结论

W 与 ΔEk 在实验误差范围内一致。
`;

const MISSING_SECTIONS = `# 报告标题

## 实验目的

只写了目的。
`;

const NO_CHART = `# 报告标题

## 实验目的

验证动能定理。

## 原理公式

W = ΔEk

## 数据表格

| 质量 | 倾角 | 初速 | 末速 | W | ΔEk |
| --- | --- | --- | --- | --- | --- |
| 0.5 | 15 | 0.42 | 1.11 | 0.267 | 0.265 |
| 1.0 | 15 | 0.40 | 1.53 | 0.979 | 0.971 |

## 误差分析

1%。

## 结论

成立。
`;

const TABLE_MISSING_COLUMN = `# 报告标题

## 实验目的

验证动能定理。

## 原理公式

W = ΔEk

## 数据表格

| 质量 | 倾角 | 初速 | 末速 |
| --- | --- | --- | --- |
| 0.5 | 15 | 0.42 | 1.11 |
| 1.0 | 15 | 0.40 | 1.53 |

## 图表

![chart](./c.png)

## 误差分析

1%。

## 结论

成立。
`;

const TABLE_ONE_ROW = `# 报告标题

## 实验目的

验证动能定理。

## 原理公式

W = ΔEk

## 数据表格

| 质量 | 倾角 | 初速 | 末速 | W | ΔEk |
| --- | --- | --- | --- | --- | --- |
| 0.5 | 15 | 0.42 | 1.11 | 0.267 | 0.265 |

## 图表

![chart](./c.png)

## 误差分析

1%。

## 结论

成立。
`;

describe('DocumentStructureValidator（结构校验，纯函数）', () => {
  it('结构齐全的报告 → verdict=passed，且逐项定位到标题行', () => {
    const report = analyseDocument(bytes(COMPLETE_REPORT));
    assert.equal(report.verdict, 'passed');
    assert.equal(report.validatorVersion, DOCUMENT_VALIDATOR_VERSION);
    assert.deepEqual(report.missing, []);
    const purpose = report.sections.find((section) => section.id === 'purpose');
    assert.equal(purpose?.present, true);
    assert.equal(purpose?.heading, '实验目的');
    // 行号是 1 起的真实行号（`## 实验目的` 在第 3 行）。
    assert.equal(purpose?.headingLine, 3);
    assert.equal(report.tables.length, 1);
    assert.equal(report.tables[0]?.rowCount, 2);
    assert.equal(report.tables[0]?.columnCount, 6);
    assert.deepEqual(report.tables[0]?.columns, ['质量', '倾角', '初速', '末速', 'W', 'ΔEk']);
    assert.equal(report.charts.length, 1);
    assert.equal(report.charts[0]?.kind, 'image');
    assert.equal(report.charts[0]?.ref, './chart.png');
  });

  it('确定性：同一份字节跑两次 → 逐字段相同（含 sha256）', () => {
    const first = analyseDocument(bytes(COMPLETE_REPORT));
    const second = analyseDocument(bytes(COMPLETE_REPORT));
    assert.deepEqual(first, second);
    assert.equal(first.sha256.length, 64);
    assert.equal(first.byteLength, bytes(COMPLETE_REPORT).byteLength);
  });

  it('缺项被点名：缺章节 + 缺图表', () => {
    const report = analyseDocument(bytes(MISSING_SECTIONS));
    assert.equal(report.verdict, 'incomplete');
    assert.ok(report.missing.includes('principle'));
    assert.ok(report.missing.includes('data_table'));
    assert.ok(report.missing.includes('error_analysis'));
    assert.ok(report.missing.includes('conclusion'));
    assert.ok(report.missing.includes('chart'));
    assert.equal(report.sections.find((section) => section.id === 'purpose')?.present, true);
  });

  it('没有任何图表引用 → missing 含 chart（章节存在也不算）', () => {
    const report = analyseDocument(bytes(NO_CHART));
    assert.equal(report.verdict, 'incomplete');
    assert.deepEqual(report.charts, []);
    assert.ok(report.missing.includes('chart'));
    // 章节标题「图表」本身在这份样本里也不存在，两项都要出现。
    assert.ok(report.missing.includes('chart'));
  });

  it('表格缺列 / 数据行不足 → missing 含 data_table', () => {
    const missingColumn = analyseDocument(bytes(TABLE_MISSING_COLUMN));
    assert.ok(missingColumn.missing.includes('data_table'));
    assert.equal(missingColumn.tables.length, 1);
    const oneRow = analyseDocument(bytes(TABLE_ONE_ROW));
    assert.ok(oneRow.missing.includes('data_table'));
    assert.equal(oneRow.tables[0]?.rowCount, 1);
  });

  it('表格判定是**子集**：多余列允许，缺列不允许', () => {
    const extraColumn = COMPLETE_REPORT.replace(
      '| 质量 | 倾角 | 初速 | 末速 | W | ΔEk |',
      '| 质量 | 倾角 | 初速 | 末速 | W | ΔEk | 备注 |',
    ).replace(
      '| --- | --- | --- | --- | --- | --- |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    ).replace(
      '| 0.5 | 15 | 0.42 | 1.11 | 0.267 | 0.265 |',
      '| 0.5 | 15 | 0.42 | 1.11 | 0.267 | 0.265 | 两次均值 |',
    ).replace(
      '| 1.0 | 15 | 0.40 | 1.53 | 0.979 | 0.971 |',
      '| 1.0 | 15 | 0.40 | 1.53 | 0.979 | 0.971 | 两次均值 |',
    );
    assert.equal(analyseDocument(bytes(extraColumn)).verdict, 'passed');
  });

  it('代码块里的管道符不算表格（不误判）', () => {
    const fenced = `# 报告标题

\`\`\`text
| 质量 | 倾角 | 初速 | 末速 | W | ΔEk |
| --- | --- | --- | --- | --- | --- |
| a | b | c | d | e | f |
\`\`\`

## 实验目的

x
`;
    const report = analyseDocument(bytes(fenced));
    assert.deepEqual(report.tables, []);
  });

  it('mermaid 图块也算图表引用（kind=diagram）', () => {
    const withDiagram = `${COMPLETE_REPORT}\n\`\`\`mermaid\ngraph TD; A-->B;\n\`\`\`\n`;
    const report = analyseDocument(bytes(withDiagram));
    assert.ok(report.charts.some((chart) => chart.kind === 'diagram'));
    // 此时既有图片也有图块：两条都记录，仍为 passed。
    assert.equal(report.verdict, 'passed');
  });

  it('空字节：结构必然不全，且不抛异常', () => {
    const report = analyseDocument(new Uint8Array(0));
    assert.equal(report.verdict, 'incomplete');
    assert.equal(report.byteLength, 0);
    assert.equal(report.sha256.length, 64);
    assert.equal(report.sections.every((section) => !section.present), true);
  });

  it('服务端已知标题可满足 title 章节（不接受客户端新填字段的伪造）', () => {
    const noHeading = COMPLETE_REPORT.replace('# 实验报告标题\n', '');
    const withoutTitle = analyseDocument(bytes(noHeading));
    assert.equal(withoutTitle.sections.find((section) => section.id === 'title')?.present, false);
    const withServerTitle = analyseDocument(bytes(noHeading), { title: '动能定理实验报告' });
    const title = withServerTitle.sections.find((section) => section.id === 'title');
    assert.equal(title?.present, true);
    assert.equal(title?.heading, '动能定理实验报告');
  });

  it('读端口：读得到就出报告，读不到返回 null（不假装通过）', async () => {
    const reader = new InMemoryArtifactBytesReader();
    reader.seed('reports/kinetic.md', COMPLETE_REPORT, 'text/markdown');
    const outcome = await validateDocumentStructure(reader, 'reports/kinetic.md');
    assert.ok(outcome !== null);
    assert.equal(outcome.report.verdict, 'passed');
    assert.equal(await validateDocumentStructure(reader, 'reports/missing.md'), null);
  });

  it('证据引用只带不透明引用 + 版本 + 摘要（不含正文）', async () => {
    const reader = new InMemoryArtifactBytesReader();
    reader.seed('reports/kinetic.md', COMPLETE_REPORT);
    const outcome = await validateDocumentStructure(reader, 'reports/kinetic.md');
    assert.ok(outcome !== null);
    const ref = toDocumentEvidenceRef({ artifactId: 'art-1', artifactVersionId: 'artv-1', outcome });
    assert.equal(ref.verdict, 'passed');
    assert.equal(ref.validatorVersion, DOCUMENT_VALIDATOR_VERSION);
    const serialized = JSON.stringify(ref);
    assert.equal(serialized.includes('动能定理'), false);
    assert.equal(serialized.includes('0.267'), false);
    const label = documentEvidenceLabel(ref);
    assert.ok(label.includes(DOCUMENT_VALIDATOR_VERSION));
    assert.ok(label.includes(ref.sha256.slice(0, 12)));
    assert.equal(label.includes('0.267'), false);
  });

  it('默认 profile 就是动能定理报告形状', () => {
    assert.equal(KINETIC_ENERGY_REPORT_PROFILE.id, 'kinetic-energy-report');
    assert.deepEqual(
      KINETIC_ENERGY_REPORT_PROFILE.sections.map((section) => section.id),
      ['title', 'purpose', 'principle', 'data_table', 'chart', 'error_analysis', 'conclusion'],
    );
  });
});

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
