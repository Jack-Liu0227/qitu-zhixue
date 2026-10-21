import type { StudentLearningAnalysisStatus } from '@qitu/contracts';

export function analysisStatusMessage(analysis: StudentLearningAnalysisStatus): string {
  if (analysis.status === 'accepted') return '已根据核验后的学习记录更新。';
  if (analysis.status === 'unavailable') return '还没有已确认的分析。保留真实的探究记录后，这里会逐步更新。';
  if (analysis.pendingReason === 'PROJECTION_NO_NEW_OBSERVATION') {
    return '最近的记录暂未增加新的画像线索；已有的确认内容不会因此消失。';
  }
  if (['PROJECTION_UNKNOWN_FIELD', 'PROJECTION_RESULT_INVALID', 'PROJECTION_EVIDENCE_INVALID'].includes(analysis.pendingReason ?? '')) {
    return '最近一次分析未通过结果核验，暂不展示该次结论；已确认内容仍可查看。';
  }
  if (analysis.pendingReason) return '新的分析还需要核验证据；已确认内容仍可查看。';
  return '新的学习记录正在整理；已确认内容仍可查看。';
}
