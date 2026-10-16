import { createHash } from 'node:crypto';

export interface ReportStudentFact { id: string; stage?: string | null; progressPercent?: number | null; stalled?: boolean; projectCount?: number }
export interface ReportParentFact { id: string; authorizedStudentCount?: number }
export interface ReportTeacherFact { id: string; activeStudentCount?: number; pendingInterventionCount?: number }
export interface ReportAggregationInput { students?: readonly ReportStudentFact[]; parents?: readonly ReportParentFact[]; teachers?: readonly ReportTeacherFact[]; range?: { from: string; to: string }; generatedAt?: string; source?: readonly string[] }
export interface AggregatedReport {
  summary: { studentCount: number; parentCount: number; teacherCount: number; projectCount: number; stalledStudentCount: number; pendingInterventionCount: number };
  range: { from: string; to: string }; sources: readonly string[]; generatedAt: string; redacted: true;
  students: ReadonlyArray<{ idHash: string; stage: string | null; progressPercent: number | null; stalled: boolean; projectCount: number }>;
  parents: ReadonlyArray<{ idHash: string; authorizedStudentCount: number }>;
  teachers: ReadonlyArray<{ idHash: string; activeStudentCount: number; pendingInterventionCount: number }>;
}
const hash = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);
export function aggregateReportFacts(input: ReportAggregationInput): AggregatedReport {
  const students = input.students ?? [], parents = input.parents ?? [], teachers = input.teachers ?? [];
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return {
    summary: { studentCount: students.length, parentCount: parents.length, teacherCount: teachers.length,
      projectCount: students.reduce((s, x) => s + Math.max(0, x.projectCount ?? 0), 0), stalledStudentCount: students.filter((x) => x.stalled === true).length,
      pendingInterventionCount: teachers.reduce((s, x) => s + Math.max(0, x.pendingInterventionCount ?? 0), 0) },
    range: input.range ?? { from: new Date(Date.now() - 86_400_000).toISOString(), to: generatedAt },
    sources: [...new Set((input.source ?? ['projects', 'guardian_links', 'mentor_assignments']).map(String))], generatedAt, redacted: true,
    students: students.map((x) => ({ idHash: hash(x.id), stage: x.stage ?? null, progressPercent: typeof x.progressPercent === 'number' ? Math.max(0, Math.min(100, x.progressPercent)) : null, stalled: x.stalled === true, projectCount: Math.max(0, x.projectCount ?? 0) })),
    parents: parents.map((x) => ({ idHash: hash(x.id), authorizedStudentCount: Math.max(0, x.authorizedStudentCount ?? 0) })),
    teachers: teachers.map((x) => ({ idHash: hash(x.id), activeStudentCount: Math.max(0, x.activeStudentCount ?? 0), pendingInterventionCount: Math.max(0, x.pendingInterventionCount ?? 0) })),
  };
}
const SENSITIVE = /conversation|transcript|audio|voice|secret|token|password|prompt|risk|phone|email|open[_-]?id/i;
export function redactReport<T>(value: T): T {
  const walk = (x: unknown): unknown => Array.isArray(x) ? x.map(walk) : (!x || typeof x !== 'object' ? x : Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([k]) => !SENSITIVE.test(k)).map(([k, v]) => [k, walk(v)])));
  return walk(value) as T;
}
