export interface FeishuReportIssueSummary {
  studentIssues: readonly string[];
  parentIssues: readonly string[];
  teacherIssues: readonly string[];
  formattedText: string;
}

export interface FeishuReportDocument {
  summary: { studentCount: number; parentCount: number; teacherCount: number; projectCount: number; stalledStudentCount: number; pendingInterventionCount: number };
  range: { from: string; to: string };
  sources: readonly string[];
  generatedAt: string;
  redacted: true;
  students: readonly unknown[];
  parents: readonly unknown[];
  teachers: readonly unknown[];
  issueSummary?: FeishuReportIssueSummary;
}

