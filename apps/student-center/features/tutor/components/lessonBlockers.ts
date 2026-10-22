/** Explain server decisions without inferring completion on the client. */
export function lessonBlockerLabel(code: string): string {
  const labels: Record<string, string> = {
    LESSON_ACTIVITIES_INCOMPLETE: '\u8bf7\u5148\u5b8c\u6210\u672c\u8bfe\u5404\u6d3b\u52a8\u5e76\u53d6\u5f97\u8bc4\u4ef7\u56de\u6267\u3002',
    LESSON_QUALITY_REQUIRED: '本课产物尚未取得当前版本的质量评价，请查看反馈或等待班主任复核。',
    LEARNING_SESSION_CONTRACT_REQUIRED: '课时任务配置尚未准备完整，请联系老师。',
    REQUIRED_THEORY_NOT_MASTERED: '请先完成本课要求的正式目标考核。',
    THEORY_GATE_REQUIRED: '请先完成理论学习与考核，再开始实践。',
    PENDING_QUESTION_REQUIRES_ANSWER: '还有一道正在进行的题目，请先完成作答。',
    PREVIOUS_SESSION_INCOMPLETE: '请先完成前一课时。',
    LEARNING_PLAN_NOT_ACTIVE: '学习计划暂未开始或已结束。',
    SUBMITTED_REPORT_APPROVAL_REQUIRED: '本课提交的报告需要当前班主任审核通过并发布。',
    'EVIDENCE_REQUIRED:session_response': '请先保存本课时回答或所要求的反思。',
    'EVIDENCE_REQUIRED:experiment_observation': '请在对话实验中保存本课的观察记录。',
    'EVIDENCE_REQUIRED:submitted_artifact': '请先提交本课时作品报告。',
    'EVIDENCE_REQUIRED:approved_artifact': '需要已由当前班主任审核通过并发布的作品。',
  };
  return labels[code] ?? '本课还有服务端要求未满足，请刷新或联系老师。';
}
