import { createHash } from 'node:crypto';
import type { ArtifactBytesReader } from './artifact-bytes.reader';

/**
 * 文档 / 报告**结构**校验器 —— 纯函数、确定性、无模型调用、无网络。
 *
 * ============================ 语义红旗（必读） ============================
 *
 * 本校验器只回答一个结构问题：**报告里该有的章节、表格、图表在不在**。
 * 它**不**回答「这个实验做得对不对」——
 *
 * - 判「误差是否小于 5%」「初速与末速是否满足动能定理」属于 **AI 候选**
 *   （`ProjectReviewCandidate` 的逐条 criterion + rationale），不属于本函数；
 * - 本函数返回的 `verdict: 'passed'` 的准确语义是
 *   「**结构完整**」，任何 UI / 文案不得把它写成「报告合格」「实验正确」。
 *
 * ======================= 证据落库口径（与本工作流一致） =======================
 *
 * `PROJECT_EVIDENCE_SOURCE_KINDS` 只有
 * `task_submission | tutor_turn | escalation_event | reflection | mastery_attempt | artifact`，
 * 没有 `document` / `video`；`ProjectEvidenceFact` 只带一个不透明 `sourceId`
 * 加一段可选 `detail`，**永远不可能承载文件正文或媒体 URL**。
 *
 * 因此：文档与视频的**权威记录是 `artifact_versions` 行**，`project_evidence`
 * 只承载「引用了哪个版本 + 校验器版本 + 摘要」，本体不进证据表、不进日志、
 * 不进模型上下文。本文件里的 `DocumentEvidenceRef` 就是那条引用。
 *
 * ================================ 读字节 ================================
 * 字节通过注入的 `ArtifactBytesReader` 读取（见 `artifact-bytes.reader.ts`），
 * 因此今天就能在进程内完整单测；真实对象存储读路径是**已声明延后项**，
 * 未配置时抛稳定错误码 `OBJECT_STORAGE_READ_NOT_CONFIGURED`，
 * 绝不把「读不到」当成「校验不通过」。
 */

/** 校验器版本号：写进报告、写进证据 label，保证结论可追溯。 */
export const DOCUMENT_VALIDATOR_VERSION = 'doc-structure-v1';

/** 单次读取上限（8MB）：报告类 Markdown 远超此值即不是给人看的报告。 */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export interface DocumentSectionSpec {
  /** 稳定章节 id（报告缺项时用于 `missing`）。 */
  id: string;
  /** 允许的标题写法（至少一个命中即算该章节存在，精确匹配去空白后的大小写无关串）。 */
  aliases: readonly string[];
}

export interface DocumentTableSpec {
  /** 期望的列名（判定为**子集**：额外列允许，缺失列不允许）。 */
  requiredColumns: readonly string[];
  /** 数据行（不含表头与分隔行）下限。 */
  minDataRows: number;
}

export interface DocumentStructureProfile {
  id: string;
  /** 章节（`data_table` / `chart` 既是章节又是结构要求，见下）。 */
  sections: readonly DocumentSectionSpec[];
  /** 数据表格要求；null = 不要求表格。 */
  table: DocumentTableSpec | null;
  /** 是否要求至少一个图表引用（Markdown 图片 / HTML img / mermaid 图）。 */
  requireChart: boolean;
}

/**
 * 「动手学动能定理」报告形状：报告标题 / 实验目的 / 原理公式 / 数据表格 /
 * 图表 / 误差分析 / 结论。逐项只判**存在性**。
 */
export const KINETIC_ENERGY_REPORT_PROFILE: DocumentStructureProfile = Object.freeze({
  id: 'kinetic-energy-report',
  sections: [
    { id: 'title', aliases: ['报告标题', '标题', '实验报告标题'] },
    { id: 'purpose', aliases: ['实验目的', '目的'] },
    { id: 'principle', aliases: ['原理公式', '实验原理', '原理'] },
    { id: 'data_table', aliases: ['数据表格', '实验数据', '数据'] },
    { id: 'chart', aliases: ['图表', '图像', '图', '作图'] },
    { id: 'error_analysis', aliases: ['误差分析', '误差'] },
    { id: 'conclusion', aliases: ['结论', '实验结论'] },
  ],
  table: {
    requiredColumns: ['质量', '倾角', '初速', '末速', 'W', 'ΔEk'],
    minDataRows: 2,
  },
  requireChart: true,
});

export interface DocumentSectionFinding {
  id: string;
  present: boolean;
  /** 命中的标题所在行号（1 起）；未命中为 null。 */
  headingLine: number | null;
  /** 命中的标题原文（已去 `#`）；未命中为 null。 */
  heading: string | null;
}

export interface DocumentTableFinding {
  /** 最近的上级标题文本（去 `#`）；无则 `table-<序号>`。 */
  caption: string;
  /** 数据行数（不含表头与 `---` 分隔行）。 */
  rowCount: number;
  columnCount: number;
  columns: readonly string[];
  /** 起始行号（1 起）。 */
  startLine: number;
}

export interface DocumentChartFinding {
  /** 引用字符串（Markdown 图片地址 / img src / diagram 语言）。 */
  ref: string;
  kind: 'image' | 'html_img' | 'diagram';
  line: number;
}

export interface DocumentValidationReport {
  validatorVersion: string;
  profileId: string;
  /** 被校验字节的 sha256（不是文件名的哈希）。 */
  sha256: string;
  byteLength: number;
  sections: readonly DocumentSectionFinding[];
  tables: readonly DocumentTableFinding[];
  charts: readonly DocumentChartFinding[];
  /**
   * 结构缺项 id 清单：缺失的章节 id，外加两条结构性要求 id
   * （`data_table` = 没有任何满足列/行要求的表；`chart` = 没有任何图表引用）。
   * 章节标题存在但表不合格时，`data_table` 同样出现在这里——
   * 那正是「该项在可用的意义上缺失」。
   */
  missing: readonly string[];
  /**
   * `passed` = **结构完整**（章节齐 + 表格合要求 + 有图表）。
   * 语义绝不等于「内容正确」。内容判定属于 AI 候选。
   */
  verdict: 'passed' | 'incomplete';
}

export interface ValidateDocumentOptions {
  profile?: DocumentStructureProfile;
  /**
   * 服务端已知的作品标题（来自 `artifact_versions.title`，非客户端新填字段）。
   * 传了就视为 `title` 章节命中，否则要求正文里存在 H1 标题。
   */
  title?: string | null;
  maxBytes?: number;
}

export interface DocumentValidationOutcome {
  /** 被读取的对象引用（不透明）。 */
  objectKey: string;
  report: DocumentValidationReport;
}

/** 空字节：读到了对象但内容为空（结构必然不全）。 */
function emptyReport(profile: DocumentStructureProfile, sha256: string, byteLength: number): DocumentValidationReport {
  return {
    validatorVersion: DOCUMENT_VALIDATOR_VERSION,
    profileId: profile.id,
    sha256,
    byteLength,
    sections: profile.sections.map((section) => ({
      id: section.id,
      present: false,
      headingLine: null,
      heading: null,
    })),
    tables: [],
    charts: [],
    missing: profile.sections.map((section) => section.id),
    verdict: 'incomplete',
  };
}

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const HTML_IMG = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const MARKDOWN_IMG = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
const FENCE = /^\s*(```+|~~~+)\s*([A-Za-z0-9_+-]*)\s*$/;

/** 标题归一：去空白、去括号内说明、去 `/` 或 `·` 之后的量纲、小写。 */
function normalizeLabel(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/[\/·：:].*$/, '')
    .toLowerCase();
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')));
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
}

/**
 * 纯函数核心：只吃字节，吐结构化结论。没有 I/O、没有随机、没有时间。
 * 同样的字节 + 同样的 profile ⇒ 逐字段相同的报告（含 sha256）。
 */
export function analyseDocument(
  bytes: Uint8Array,
  options: ValidateDocumentOptions = {},
): DocumentValidationReport {
  const profile = options.profile ?? KINETIC_ENERGY_REPORT_PROFILE;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength === 0) return emptyReport(profile, sha256, 0);

  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const lines = text.split(/\r?\n/);

  const headings: Array<{ line: number; text: string; level: number }> = [];
  const tables: DocumentTableFinding[] = [];
  const charts: DocumentChartFinding[] = [];
  const fenceStack: Array<{ marker: string; language: string; line: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1]![0] === '`' ? '```' : '~~~';
      const language = (fence[2] ?? '').toLowerCase();
      if (fenceStack.length > 0 && fenceStack[fenceStack.length - 1]!.marker === marker) {
        fenceStack.pop();
      } else {
        fenceStack.push({ marker, language, line: lineNumber });
        // mermaid / graphviz 图块 = 图表引用（是图表，但没有图片地址）。
        if (language === 'mermaid' || language === 'dot' || language === 'graphviz') {
          charts.push({ ref: `diagram:${language}`, kind: 'diagram', line: lineNumber });
        }
      }
      continue;
    }
    if (fenceStack.length > 0) continue; // 代码块内不解析标题 / 表格。

    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      headings.push({ line: lineNumber, text: (heading[2] ?? '').trim(), level: heading[1]!.length });
      continue;
    }

    if (isTableRow(line)) {
      const header = splitRow(line);
      const next = lines[index + 1] ?? '';
      if (!isTableRow(next) || !isSeparatorRow(next)) continue; // 非完整 pipe 表。
      let rowCount = 0;
      let cursor = index + 2;
      while (cursor < lines.length && isTableRow(lines[cursor] ?? '')) {
        if (!isSeparatorRow(lines[cursor] ?? '')) rowCount += 1;
        cursor += 1;
      }
      const captionLine = [...headings].reverse().find((entry) => entry.line < lineNumber);
      tables.push({
        caption: captionLine?.text ?? `table-${tables.length + 1}`,
        rowCount,
        columnCount: header.length,
        columns: header,
        startLine: lineNumber,
      });
      index = cursor - 1;
      continue;
    }

    MARKDOWN_IMG.lastIndex = 0;
    const markdown = MARKDOWN_IMG.exec(line);
    if (markdown !== null) {
      charts.push({ ref: markdown[1]!, kind: 'image', line: lineNumber });
      continue;
    }
    HTML_IMG.lastIndex = 0;
    const html = HTML_IMG.exec(line);
    if (html !== null) {
      charts.push({ ref: html[1]!, kind: 'html_img', line: lineNumber });
    }
  }

  const titleFromServer = typeof options.title === 'string' && options.title.trim().length > 0;
  const hasH1 = headings.some((entry) => entry.level === 1);

  const sections: DocumentSectionFinding[] = profile.sections.map((section) => {
    const aliases = section.aliases.map(normalizeLabel);
    const match = headings.find((entry) => aliases.includes(normalizeLabel(entry.text)));
    if (match !== undefined) {
      return { id: section.id, present: true, headingLine: match.line, heading: match.text };
    }
    // `报告标题` 允许由服务端已知的作品标题满足（不是客户端可新填的字段）。
    if (section.id === 'title' && (titleFromServer || hasH1)) {
      const firstH1 = headings.find((entry) => entry.level === 1);
      return {
        id: section.id,
        present: true,
        headingLine: firstH1?.line ?? null,
        heading: firstH1?.text ?? (options.title ?? '').trim(),
      };
    }
    return { id: section.id, present: false, headingLine: null, heading: null };
  });

  const missing: string[] = sections.filter((section) => !section.present).map((section) => section.id);

  if (profile.table !== null) {
    const required = profile.table.requiredColumns.map(normalizeLabel);
    const satisfied = tables.some((table) => {
      const columns = table.columns.map(normalizeLabel);
      return table.rowCount >= profile.table!.minDataRows
        && required.every((column) => columns.includes(column));
    });
    if (!satisfied) missing.push('data_table');
  }
  if (profile.requireChart && charts.length === 0) missing.push('chart');

  return {
    validatorVersion: DOCUMENT_VALIDATOR_VERSION,
    profileId: profile.id,
    sha256,
    byteLength: bytes.byteLength,
    sections,
    tables,
    charts,
    missing,
    verdict: missing.length === 0 ? 'passed' : 'incomplete',
  };
}

/**
 * 读字节 + 结构校验。
 *
 * 读不到对象（null）返回 null，让调用方按「证据不可用」处理；
 * 读路径未配置则让 `ArtifactBytesUnavailableError` 冒泡（稳定错误码），
 * 两种情况都不会被伪装成一条「校验不通过」的证据。
 */
export async function validateDocumentStructure(
  reader: ArtifactBytesReader,
  objectKey: string,
  options: ValidateDocumentOptions = {},
): Promise<DocumentValidationOutcome | null> {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  const bytes = await reader.read(objectKey, maxBytes);
  if (bytes === null) return null;
  return { objectKey, report: analyseDocument(bytes, options) };
}

/**
 * 证据引用：文档校验结论在 `project_evidence` 里的全部内容。
 * 只有不透明引用 + 校验器版本 + 摘要，**没有报告正文**。
 */
export interface DocumentEvidenceRef {
  artifactId: string;
  artifactVersionId: string;
  objectKey: string;
  validatorVersion: string;
  sha256: string;
  verdict: DocumentValidationReport['verdict'];
}

export function toDocumentEvidenceRef(input: {
  artifactId: string;
  artifactVersionId: string;
  outcome: DocumentValidationOutcome;
}): DocumentEvidenceRef {
  return {
    artifactId: input.artifactId,
    artifactVersionId: input.artifactVersionId,
    objectKey: input.outcome.objectKey,
    validatorVersion: input.outcome.report.validatorVersion,
    sha256: input.outcome.report.sha256,
    verdict: input.outcome.report.verdict,
  };
}

/** 证据 label：把「查了什么、什么版本、哪份字节」写进一行可读文本。 */
export function documentEvidenceLabel(ref: DocumentEvidenceRef): string {
  return `报告结构校验（${ref.validatorVersion}, sha256=${ref.sha256.slice(0, 12)}）：${ref.verdict === 'passed' ? '结构完整' : '结构缺项'}`;
}
