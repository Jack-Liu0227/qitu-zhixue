import type {
  DesensitizedStuckSummary,
  StudentStuckSignal,
  StuckSummaryPriority,
} from '@qitu/contracts';

/**
 * 把学生卡点信号折叠成脱敏摘要（api-spec F4.4）。
 *
 * 红线：只保留稳定错误编码、不透明节点引用与证据引用、优先级、时间戳。
 * 不落学生对话正文、作答文本、`correctKeys`、`explanation`、`expectedAnswer`。
 *
 * 顺手保证 `stemNodeId === nodeRefs[0]`（契约不变量），即使上游 nodeRefs
 * 顺序异常也在边界处归正。
 */
export function buildDesensitizedStuckSummary(
  signal: StudentStuckSignal,
  priority: StuckSummaryPriority,
): DesensitizedStuckSummary {
  const nodeRefs = [signal.stemNodeId, ...signal.nodeRefs.filter((id) => id !== signal.stemNodeId)];
  return {
    studentId: signal.studentId,
    projectId: signal.projectId,
    planId: signal.planId,
    stemNodeId: signal.stemNodeId,
    conceptId: signal.conceptId,
    errorTypeCode: signal.errorTypeCode,
    nodeRefs,
    evidenceRefs: [...signal.evidenceRefs],
    priority,
    occurredAt: signal.emittedAt,
  };
}

/** 审计 / outbox 的脱敏 detail 基线：只放摘要，绝不夹带业务原文。 */
export function desensitizedSummaryDetail(summary: DesensitizedStuckSummary): Record<string, unknown> {
  return { ...summary, nodeRefs: [...summary.nodeRefs], evidenceRefs: [...summary.evidenceRefs] };
}

export interface DesensitizationScanIssue {
  path: string;
  reason: string;
}

/**
 * 反序列化扫描：递归检查一个 JSON 值是否可能夹带学生原文。
 *
 * - 键名命中 free-text 词表（text / answer / content / explanation / message /
 *   prompt / body / transcript / utterance / correction）即告警；
 * - 字符串值必须是不透明引用（字母数字 + `._:/-`）或 ISO-8601 时间戳；
 * - 任何 CJK 或空白都视为原文告警。
 *
 * 纯函数，供 F4.6 测试与 CI 断言复用。
 */
const FREE_TEXT_KEY = /(text|answer|content|explanation|message|prompt|body|transcript|utterance|correction)/i;
const OPAQUE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function scanDesensitized(value: unknown, path = '$'): DesensitizationScanIssue[] {
  const issues: DesensitizationScanIssue[] = [];
  if (typeof value === 'string') {
    if (FREE_TEXT_KEY.test(path)) {
      issues.push({ path, reason: 'free-text-like key' });
    }
    if (/[\u3400-\u9fff\s]/.test(value)) {
      issues.push({ path, reason: 'value contains CJK or whitespace (possible raw text)' });
    }
    if (!OPAQUE_VALUE.test(value) && !ISO_TIMESTAMP.test(value)) {
      issues.push({ path, reason: 'value is not an opaque id/code/timestamp' });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      issues.push(...scanDesensitized(item, `${path}[${index}]`));
    });
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FREE_TEXT_KEY.test(key)) {
        issues.push({ path: `${path}.${key}`, reason: 'free-text-like key' });
      }
      issues.push(...scanDesensitized(child, `${path}.${key}`));
    }
  }
  return issues;
}

/** 断言一个值不含学生原文；违例抛错（带完整路径与原因）。 */
export function assertNoRawStudentText(value: unknown): void {
  const issues = scanDesensitized(value);
  if (issues.length > 0) {
    throw new Error(
      `脱敏扫描失败: ${issues.map((issue) => `${issue.path}: ${issue.reason}`).join('; ')}`,
    );
  }
}
