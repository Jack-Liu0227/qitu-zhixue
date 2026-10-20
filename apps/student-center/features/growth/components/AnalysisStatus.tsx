import type { StudentLearningAnalysisStatus } from '@qitu/contracts';

export function AnalysisStatus({ analysis }: { analysis?: StudentLearningAnalysisStatus }) {
  if (!analysis) return null;
  const observed = analysis.observedThrough ? new Date(analysis.observedThrough) : null;
  const date = observed && Number.isFinite(observed.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(observed) : null;
  return <p role="status" className="qitu-profile-muted">
    {analysis.status === 'accepted' ? '已根据学习记录更新。'
      : analysis.status === 'pending' ? '新的学习记录正在整理或等待核验；已确认内容仍可查看。'
        : '暂时没有可展示的分析结果。'}
    {date ? ` 最近分析的对话时间：${date}。` : ''}
  </p>;
}
