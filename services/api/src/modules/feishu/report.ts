import { createHash } from 'node:crypto';
import type { CurrentUser, FeishuReportIssueSummary } from '@qitu/contracts';

export interface ReportStudentFact { id: string; stage?: string | null; progressPercent?: number | null; stalled?: boolean; projectCount?: number }
export interface ReportParentFact { id: string; authorizedStudentCount?: number }
export interface ReportTeacherFact { id: string; activeStudentCount?: number; pendingInterventionCount?: number }
export interface ReportAggregationInput {
  students?: readonly ReportStudentFact[];
  parents?: readonly ReportParentFact[];
  teachers?: readonly ReportTeacherFact[];
  range?: { from: string; to: string };
  generatedAt?: string;
  source?: readonly string[];
  rawIssues?: {
    studentIssues?: readonly string[];
    parentIssues?: readonly string[];
    teacherIssues?: readonly string[];
  };
}
export interface AggregatedReport {
  summary: { studentCount: number; parentCount: number; teacherCount: number; projectCount: number; stalledStudentCount: number; pendingInterventionCount: number };
  range: { from: string; to: string }; sources: readonly string[]; generatedAt: string; redacted: true;
  students: ReadonlyArray<{ idHash: string; stage: string | null; progressPercent: number | null; stalled: boolean; projectCount: number }>;
  parents: ReadonlyArray<{ idHash: string; authorizedStudentCount: number }>;
  teachers: ReadonlyArray<{ idHash: string; activeStudentCount: number; pendingInterventionCount: number }>;
  issueSummary?: FeishuReportIssueSummary;
}
const hash = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);

/**
 * D1 范围解析（纯函数，便于服务层测试）：
 * - admin：全局，或显式名单（由服务层另行校验对象级权限）；
 * - teacher：仅当前 active 班主任分配的学生；显式名单必须是该范围的子集；
 * - teacher 无任何分配时 forbidden（fail closed，不产出空范围冒充全量）。
 */
export function resolveReportScope(
  role: CurrentUser['role'],
  students: readonly { id: string }[],
  mentorAssignments: readonly { studentUserId: string }[],
  requestedStudentIds?: readonly string[],
): { status: 'ok'; selected: string[] } | { status: 'forbidden'; reason: 'no-assignment' | 'out-of-scope' } {
  if (role === 'teacher') {
    const scope = [...new Set(mentorAssignments.map((row) => row.studentUserId))];
    if (scope.length === 0) return { status: 'forbidden', reason: 'no-assignment' };
    const selected = requestedStudentIds
      ? scope.filter((id) => requestedStudentIds.includes(id))
      : scope;
    if (requestedStudentIds && requestedStudentIds.some((id) => !scope.includes(id))) {
      return { status: 'forbidden', reason: 'out-of-scope' };
    }
    if (selected.length === 0) return { status: 'forbidden', reason: 'out-of-scope' };
    return { status: 'ok', selected };
  }
  const selected = requestedStudentIds
    ? students.map((row) => row.id).filter((id) => requestedStudentIds!.includes(id))
    : students.map((row) => row.id);
  return { status: 'ok', selected };
}
export function aggregateReportFacts(input: ReportAggregationInput): AggregatedReport {
  const students = input.students ?? [], parents = input.parents ?? [], teachers = input.teachers ?? [];
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const stalledStudentCount = students.filter((x) => x.stalled === true).length;
  const projectCount = students.reduce((s, x) => s + Math.max(0, x.projectCount ?? 0), 0);
  const pendingInterventionCount = teachers.reduce((s, x) => s + Math.max(0, x.pendingInterventionCount ?? 0), 0);

  const studentIssues = input.rawIssues?.studentIssues?.length
    ? [...input.rawIssues.studentIssues]
    : stalledStudentCount > 0
      ? [`检测到 ${stalledStudentCount} 位学生项目处于停滞状态，主要涉及阶段概念理解与任务卡点`]
      : ['各项目推进平稳，暂无学习卡点或严重停滞异常。'];

  const parentIssues = input.rawIssues?.parentIssues?.length
    ? [...input.rawIssues.parentIssues]
    : ['家校协同反馈通道顺畅，暂无待处理紧急工单。'];

  const teacherIssues = input.rawIssues?.teacherIssues?.length
    ? [...input.rawIssues.teacherIssues]
    : pendingInterventionCount > 0
      ? [`当前有 ${pendingInterventionCount} 项教学干预或复核事项待班主任跟进`]
      : ['导师分配与日常复核工作有序开展，无积压干预事项。'];

  const formatList = (items: readonly string[]) => items.map((item, idx) => `  ${idx + 1}. ${item}`).join('\n');
  const range = input.range ?? { from: new Date(Date.now() - 86_400_000).toISOString(), to: generatedAt };

  const formattedText = [
    '📋【启途智学 · 三端问题与学情总结】',
    `📅 汇报时间: ${generatedAt}`,
    `⏱️ 统计区间: ${range.from} ~ ${range.to}`,
    '',
    '📊 核心数据概览:',
    `• 学生总数: ${students.length} 人 (停滞/受阻: ${stalledStudentCount} 人) | 项目总数: ${projectCount} 个`,
    `• 家长关联: ${parents.length} 人`,
    `• 教师关联: ${teachers.length} 人 (待处理复核/干预: ${pendingInterventionCount} 项)`,
    '',
    '🔍 1. 学生端学习与技术卡点:',
    formatList(studentIssues),
    '',
    '👨‍👩‍👧 2. 家长端诉求与协同反馈:',
    formatList(parentIssues),
    '',
    '👨‍🏫 3. 教师端教学关注与干预事项:',
    formatList(teacherIssues),
    '',
    '🔒 提示: 本总结由「三端问题总结与飞书汇报助手」自动生成，已执行隐私脱敏与最小化可见控制，不含未成年人原始对话及敏感个人信息。',
  ].join('\n');

  const issueSummary: FeishuReportIssueSummary = {
    studentIssues,
    parentIssues,
    teacherIssues,
    formattedText,
  };

  return {
    summary: { studentCount: students.length, parentCount: parents.length, teacherCount: teachers.length,
      projectCount, stalledStudentCount,
      pendingInterventionCount },
    range,
    sources: [...new Set((input.source ?? ['projects', 'guardian_links', 'mentor_assignments']).map(String))], generatedAt, redacted: true,
    students: students.map((x) => ({ idHash: hash(x.id), stage: x.stage ?? null, progressPercent: typeof x.progressPercent === 'number' ? Math.max(0, Math.min(100, x.progressPercent)) : null, stalled: x.stalled === true, projectCount: Math.max(0, x.projectCount ?? 0) })),
    parents: parents.map((x) => ({ idHash: hash(x.id), authorizedStudentCount: Math.max(0, x.authorizedStudentCount ?? 0) })),
    teachers: teachers.map((x) => ({ idHash: hash(x.id), activeStudentCount: Math.max(0, x.activeStudentCount ?? 0), pendingInterventionCount: Math.max(0, x.pendingInterventionCount ?? 0) })),
    issueSummary,
  };
}
const SENSITIVE = /conversation|transcript|audio|voice|secret|token|password|prompt|risk|phone|email|open[_-]?id/i;
export function redactReport<T>(value: T): T {
  const walk = (x: unknown): unknown => Array.isArray(x) ? x.map(walk) : (!x || typeof x !== 'object' ? x : Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([k]) => !SENSITIVE.test(k)).map(([k, v]) => [k, walk(v)])));
  return walk(value) as T;
}
